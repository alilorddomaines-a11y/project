/**
 * tasks/TaskQueue.js
 * Robust DAG-aware Task Queue with state management, retries, and serialization.
 */

import { TASK_STATUS } from './TaskDefinitions.js';

export class TaskQueue {
  constructor(tasks = [], maxRetries = 3) {
    this.tasks = tasks;
    this.maxRetries = maxRetries;
  }

  getTask(id) {
    return this.tasks.find(t => t.id === id) || null;
  }

  getAllTasks() {
    return [...this.tasks];
  }

  getNextExecutableTask() {
    const completedIds = new Set(
      this.tasks.filter(t => t.status === TASK_STATUS.SUCCESS).map(t => t.id)
    );

    // Filter pending tasks sorted by priority (ascending: 1 is highest priority)
    const pending = this.tasks
      .filter(t => t.status === TASK_STATUS.PENDING)
      .sort((a, b) => a.priority - b.priority);

    for (const task of pending) {
      const deps = task.dependencies || [];
      const canRun = deps.every(depId => completedIds.has(depId));
      if (canRun) {
        return task;
      }
    }
    return null;
  }

  markRunning(id, workspaceId) {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} not found.`);
    task.status = TASK_STATUS.RUNNING;
    task.workspace = workspaceId;
    task.updated_at = new Date().toISOString();
    return task;
  }

  markSuccess(id, outputs = {}) {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} not found.`);
    task.status = TASK_STATUS.SUCCESS;
    task.outputs = { ...task.outputs, ...outputs };
    task.updated_at = new Date().toISOString();
    return task;
  }

  markFailed(id, errorMessage) {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} not found.`);
    task.attempts = (task.attempts || 0) + 1;
    task.errors.push({
      attempt: task.attempts,
      error: errorMessage,
      timestamp: new Date().toISOString()
    });

    if (task.attempts >= this.maxRetries) {
      task.status = TASK_STATUS.BLOCKED;
    } else {
      task.status = TASK_STATUS.PENDING;
    }

    task.updated_at = new Date().toISOString();
    return task;
  }

  resetTask(id) {
    const task = this.getTask(id);
    if (!task) return null;
    task.status = TASK_STATUS.PENDING;
    task.attempts = 0;
    task.errors = [];
    task.updated_at = new Date().toISOString();
    return task;
  }

  toJSON() {
    return JSON.parse(JSON.stringify(this.tasks));
  }

  static fromJSON(jsonArray, maxRetries = 3) {
    return new TaskQueue(Array.isArray(jsonArray) ? jsonArray : [], maxRetries);
  }
}
