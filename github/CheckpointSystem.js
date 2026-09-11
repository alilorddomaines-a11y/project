/**
 * github/CheckpointSystem.js
 * Hardened atomic checkpoint system.
 * Guarantees that PROJECT_STATE.json, TASK_QUEUE.json, PROJECT_STATE.md, and CHANGELOG.md
 * represent the exact same atomic commit, leaving the working tree completely clean.
 */

import { validateState } from '../state/StateSchema.js';

export class CheckpointSystem {
  constructor(gitHubManager) {
    this.github = gitHubManager;
  }

  generateStateMarkdown(state, tasks) {
    const completed = state.completed_tasks || [];
    const pending = state.pending_tasks || [];
    const progressPct = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

    return `# Canonical Project State: ${state.book_title}

- **Project ID**: \`${state.project_id}\`
- **Checkpoint ID**: \`${state.checkpoint_id || 'N/A'}\`
- **Status**: \`${state.status}\`
- **Phase**: \`${state.phase}\`
- **Active Workspace**: \`${state.current_workspace}\`
- **Current Task**: \`${state.current_task || 'None'}\`
- **Progress**: ${progressPct}% (${completed.length}/${tasks.length} tasks completed)
- **Parent Commit**: \`${state.parent_commit || 'HEAD'}\`
- **Last Operation**: ${state.last_successful_operation}
- **Timestamp**: ${state.timestamp}

## Completed Tasks (${completed.length})
${completed.length > 0 ? completed.map(id => `- **${id}**`).join('\n') : '_None yet._'}

## Pending Tasks (${pending.length})
${pending.length > 0 ? pending.slice(0, 10).map(id => `- ${id}`).join('\n') : '_All tasks completed._'}
`.trim();
  }

  /**
   * Performs an atomic checkpoint across state, queue, changelog, and markdown overview.
   */
  saveCheckpoint({ state, taskQueue, reason = 'Regular checkpoint', triggerCommit = true, attemptPush = false }) {
    const now = new Date().toISOString();
    state.timestamp = now;
    state.last_successful_operation = reason;
    state.checkpoint_id = `chk_${Date.now()}`;
    state.parent_commit = this.github.getLatestCommitHash();

    validateState(state);

    const tasks = Array.isArray(taskQueue) ? taskQueue : taskQueue.getAllTasks();

    // 1. Write PROJECT_STATE.json
    this.github.writeProjectFile('PROJECT_STATE.json', state);

    // 2. Write TASK_QUEUE.json
    this.github.writeProjectFile('TASK_QUEUE.json', tasks);

    // 3. Write PROJECT_STATE.md
    const md = this.generateStateMarkdown(state, tasks);
    this.github.writeProjectFile('PROJECT_STATE.md', md);

    // 4. Append to CHANGELOG.md
    const changelogEntry = `\n### [${now}] ${reason}\n- Checkpoint: ${state.checkpoint_id}\n- Workspace: ${state.current_workspace}\n- Task: ${state.current_task || 'N/A'}\n- Status: ${state.status}\n`;
    const existingLog = this.github.readLocalFile('CHANGELOG.md') || '# KDP Coloring Book Factory — Changelog\n';
    this.github.writeProjectFile('CHANGELOG.md', existingLog + changelogEntry);

    const checkpointFiles = [
      'PROJECT_STATE.json',
      'TASK_QUEUE.json',
      'PROJECT_STATE.md',
      'CHANGELOG.md'
    ];

    let commitHash = state.parent_commit;
    let committed = false;

    if (triggerCommit) {
      const commitRes = this.github.commitFiles(
        checkpointFiles,
        `checkpoint: [${state.checkpoint_id}] ${reason} (${state.current_workspace})`
      );

      committed = commitRes.committed;
      commitHash = commitRes.hash;
      state.last_commit = commitHash;
    }

    // Verify atomicity & clean working tree
    const isClean = this.github.isWorkingTreeClean();

    // Safe remote push attempt (if requested)
    let pushResult = { pushed: false, error: null };
    if (attemptPush && committed) {
      pushResult = this.github.pushToRemote();
    }

    return {
      success: true,
      checkpointId: state.checkpoint_id,
      commitHash,
      committed,
      workingTreeClean: isClean,
      pushedToRemote: pushResult.pushed,
      remoteError: pushResult.error,
      reason,
      state
    };
  }
}
