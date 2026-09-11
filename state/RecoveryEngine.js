/**
 * state/RecoveryEngine.js
 * Hardened recovery engine distinguishing:
 * - Local filesystem state
 * - Committed Git state (HEAD)
 * - Remote GitHub state (origin/main)
 * 
 * Never claims remote recovery when only local files are used.
 */

import { validateState, PROJECT_STATUS } from './StateSchema.js';

export class RecoveryEngine {
  /**
   * Primary recovery method called during runtime transitions.
   */
  static recover(projectState, taskQueue) {
    return this.reconstruct(projectState, taskQueue, 'RUNTIME_RECOVERY');
  }

  /**
   * Performs core state reconstruction from parsed state & queue objects.
   */
  static reconstruct(projectState, taskQueue, source = 'UNKNOWN') {
    if (!projectState) {
      throw new Error(`Recovery failed: No project state found for source: ${source}`);
    }
    validateState(projectState);

    const tasks = Array.isArray(taskQueue) ? taskQueue : [];
    const completedSet = new Set(projectState.completed_tasks || []);

    // 1. Mark all completed tasks as SUCCESS so they are never repeated
    tasks.forEach(t => {
      if (completedSet.has(t.id)) {
        t.status = 'SUCCESS';
      }
    });

    // 2. Locate interrupted tasks (left in RUNNING state) and reset to PENDING
    let interruptedTask = tasks.find(t => t.status === 'RUNNING');
    if (interruptedTask) {
      interruptedTask.status = 'PENDING';
      interruptedTask.attempts = (interruptedTask.attempts || 0) + 1;
    }

    // 3. Resolve next executable task via DAG dependencies
    const pendingTasks = tasks.filter(t => t.status === 'PENDING');
    let nextTask = null;

    for (const candidate of pendingTasks) {
      const deps = candidate.dependencies || [];
      const depsSatisfied = deps.every(dId => completedSet.has(dId));
      if (depsSatisfied) {
        nextTask = candidate;
        break;
      }
    }

    let determinedStatus;
    if (projectState.status === PROJECT_STATUS.PAUSED) {
      determinedStatus = PROJECT_STATUS.PAUSED;
    } else if (projectState.status === PROJECT_STATUS.STOPPED) {
      determinedStatus = PROJECT_STATUS.STOPPED;
    } else if (!nextTask) {
      determinedStatus = PROJECT_STATUS.SUCCESS;
    } else {
      determinedStatus = projectState.status === PROJECT_STATUS.INITIALIZING
        ? PROJECT_STATUS.INITIALIZING
        : PROJECT_STATUS.RUNNING;
    }

    const recoveredState = {
      ...projectState,
      status: determinedStatus,
      current_task: nextTask ? nextTask.id : null,
      last_successful_operation: `Recovered context from ${source} (${projectState.last_commit || 'HEAD'})`,
      timestamp: new Date().toISOString()
    };

    return {
      recoveredState,
      tasks,
      nextTask,
      completedCount: completedSet.size,
      remainingCount: tasks.length - completedSet.size,
      recoverySource: source
    };
  }

  /**
   * Source A: Recover from local uncommitted filesystem files
   */
  static recoverFromLocal(githubManager) {
    const stateRaw = githubManager.readLocalFile('PROJECT_STATE.json');
    const queueRaw = githubManager.readLocalFile('TASK_QUEUE.json');

    if (!stateRaw || !queueRaw) {
      throw new Error('Local state files (PROJECT_STATE.json / TASK_QUEUE.json) not found.');
    }

    return this.reconstruct(JSON.parse(stateRaw), JSON.parse(queueRaw), 'LOCAL_FILESYSTEM');
  }

  /**
   * Source B: Recover from committed Git repository state (HEAD)
   */
  static recoverFromGit(githubManager, commitRef = 'HEAD') {
    const stateRaw = githubManager.readCommittedFile('PROJECT_STATE.json', commitRef);
    const queueRaw = githubManager.readCommittedFile('TASK_QUEUE.json', commitRef);

    if (!stateRaw || !queueRaw) {
      throw new Error(`Committed state files not found at git ref: ${commitRef}`);
    }

    return this.reconstruct(JSON.parse(stateRaw), JSON.parse(queueRaw), 'COMMITTED_GIT_STATE');
  }

  /**
   * Source C: Recover from remote GitHub repository (origin/main)
   */
  static recoverFromRemote(githubManager, branch = 'main') {
    githubManager.verifyCanonicalRemote();

    if (!githubManager.isRemoteReachable()) {
      throw new Error('GitHub remote origin is currently unreachable or requires authentication.');
    }

    const remoteHash = githubManager.getRemoteCommitHash(branch);
    if (!remoteHash) {
      throw new Error(`Remote branch origin/${branch} has no commits yet or is not readable.`);
    }

    // Read committed files at the remote commit reference
    return this.recoverFromGit(githubManager, remoteHash);
  }
}
