/**
 * state/RecoveryEngine.js
 * Startup and crash recovery engine. Reconstructs execution context from
 * PROJECT_STATE.json and TASK_QUEUE.json without repeating completed work.
 */

import { validateState, PROJECT_STATUS } from './StateSchema.js';

export class RecoveryEngine {
  /**
   * Reconstructs execution state from persisted files.
   * @param {Object} projectState - Parsed PROJECT_STATE.json
   * @param {Array} taskQueue - Parsed TASK_QUEUE.json array
   * @returns {Object} { recoveredState, nextTask, resumePlan }
   */
  static recover(projectState, taskQueue) {
    if (!projectState) {
      throw new Error('Recovery failed: No project state provided.');
    }
    validateState(projectState);

    const tasks = Array.isArray(taskQueue) ? taskQueue : [];
    const completedSet = new Set(projectState.completed_tasks || []);

    // Sanity check: Ensure tasks in completedSet are marked SUCCESS in queue
    tasks.forEach(t => {
      if (completedSet.has(t.id)) {
        t.status = 'SUCCESS';
      }
    });

    // Locate interrupted task if any was left in RUNNING status
    let interruptedTask = tasks.find(t => t.status === 'RUNNING');
    if (interruptedTask) {
      interruptedTask.status = 'PENDING';
      interruptedTask.attempts = (interruptedTask.attempts || 0) + 1;
    }

    // Find the next task: first non-completed, non-skipped task whose dependencies are satisfied
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

    const recoveredState = {
      ...projectState,
      status: nextTask ? PROJECT_STATUS.RUNNING : PROJECT_STATUS.SUCCESS,
      current_task: nextTask ? nextTask.id : null,
      last_successful_operation: `Recovered context from commit ${projectState.last_commit || 'HEAD'}`,
      timestamp: new Date().toISOString()
    };

    return {
      recoveredState,
      tasks,
      nextTask,
      completedCount: completedSet.size,
      remainingCount: tasks.length - completedSet.size
    };
  }
}
