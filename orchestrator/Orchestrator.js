/**
 * orchestrator/Orchestrator.js
 * Central production orchestrator coordinating TaskQueue, WorkspaceManager,
 * LovableAdapter, CheckpointSystem, and RecoveryEngine.
 */

import { TaskQueue } from '../tasks/TaskQueue.js';
import { WorkspaceManager } from '../workspaces/WorkspaceManager.js';
import { LovableAdapter } from '../lovable/LovableAdapter.js';
import { PromptBuilder } from '../lovable/PromptBuilder.js';
import { CheckpointSystem } from '../github/CheckpointSystem.js';
import { GitHubManager } from '../github/GitHubManager.js';
import { RecoveryEngine } from '../state/RecoveryEngine.js';
import { createInitialState, PROJECT_STATUS } from '../state/StateSchema.js';

export class Orchestrator {
  constructor(options = {}) {
    this.github = options.github || new GitHubManager(options.githubConfig);
    this.checkpoint = options.checkpoint || new CheckpointSystem(this.github);
    this.workspaces = options.workspaces || new WorkspaceManager(options.workspaceList);
    this.adapter = options.adapter || new LovableAdapter(options.driverType || 'simulation', options.driverOptions);
    this.taskQueue = options.taskQueue || new TaskQueue();
    this.state = options.initialState || null;
    this.isPaused = false;
    this.isStopped = false;
    this.logs = [];
  }

  log(message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      message,
      data
    };
    this.logs.unshift(entry);
    if (this.logs.length > 200) this.logs.pop();
    if (this.onLog) this.onLog(entry);
  }

  initProject(spec, tasks) {
    this.taskQueue = new TaskQueue(tasks);
    const initialWs = this.workspaces.getNextWorkspace();
    if (!initialWs) throw new Error('No enabled workspaces available in configuration.');

    this.workspaces.markActive(initialWs.id);
    this.state = createInitialState(spec, tasks, initialWs.id);

    this.checkpoint.saveCheckpoint({
      state: this.state,
      taskQueue: this.taskQueue,
      reason: 'Project initialized',
      triggerCommit: true
    });

    this.log(`Project initialized: "${this.state.book_title}" on workspace ${initialWs.id}`);
    return this.state;
  }

  pause() {
    this.isPaused = true;
    if (this.state) this.state.status = PROJECT_STATUS.PAUSED;
    this.log('Orchestrator paused by user.');
    return { ok: true, status: 'PAUSED' };
  }

  resume() {
    this.isPaused = false;
    this.isStopped = false;
    if (this.state) this.state.status = PROJECT_STATUS.RUNNING;
    this.log('Orchestrator resumed.');
    return { ok: true, status: 'RUNNING' };
  }

  stop() {
    this.isStopped = true;
    this.isPaused = false;
    if (this.state) {
      this.state.status = PROJECT_STATUS.STOPPED;
      this.checkpoint.saveCheckpoint({
        state: this.state,
        taskQueue: this.taskQueue,
        reason: 'Orchestrator stopped',
        triggerCommit: true
      });
    }
    this.log('Orchestrator stopped and checkpoint saved.');
    return { ok: true, status: 'STOPPED' };
  }

  /**
   * Executes a single step in the production pipeline.
   * Handles task execution, limit detection, checkpointing, and workspace transition.
   */
  async step() {
    if (this.isPaused || this.isStopped) {
      return { status: this.state?.status || 'IDLE', active: false };
    }

    const currentWs = this.workspaces.getWorkspace(this.state.current_workspace);
    if (!currentWs) {
      throw new Error(`Workspace ${this.state.current_workspace} not found in manager.`);
    }

    // 1. Evaluate capability: canContinue(currentWs)
    const canContinue = await this.adapter.canContinue(currentWs);

    if (!canContinue) {
      this.log(`Workspace ${currentWs.id} legitimately cannot continue. Initiating transition protocol.`);

      // Step A: Save atomic checkpoint before switching
      this.checkpoint.saveCheckpoint({
        state: this.state,
        taskQueue: this.taskQueue,
        reason: `Workspace ${currentWs.id} limit reached — Handover initiated`,
        triggerCommit: true
      });

      // Step B: Mark current workspace unavailable for current run
      this.workspaces.markUnavailable(currentWs.id, 'Legitimate limit reached');

      // Step C: Select next enabled workspace
      const nextWs = this.workspaces.getNextWorkspace(currentWs.id);
      if (!nextWs) {
        this.state.status = PROJECT_STATUS.PAUSED;
        this.log('ALL 15 WORKSPACES UNAVAILABLE FOR CURRENT RUN. Pausing factory safely.');
        this.checkpoint.saveCheckpoint({
          state: this.state,
          taskQueue: this.taskQueue,
          reason: 'All workspaces exhausted',
          triggerCommit: true
        });
        return { status: 'ALL_WORKSPACES_EXHAUSTED', active: false };
      }

      // Step D: Reconstruct context from GitHub
      const recovery = RecoveryEngine.recover(this.state, this.taskQueue.getAllTasks());
      this.state = recovery.recoveredState;
      this.state.current_workspace = nextWs.id;
      this.workspaces.markActive(nextWs.id);

      this.log(`Transition complete: Handed over from ${currentWs.id} to ${nextWs.id}. Context reconstructed.`);

      return {
        event: 'WORKSPACE_TRANSITION',
        from: currentWs.id,
        to: nextWs.id,
        reconstructedTask: recovery.nextTask?.id || null,
        active: true
      };
    }

    // 2. Fetch next executable task from TaskQueue
    const task = this.taskQueue.getNextExecutableTask();
    if (!task) {
      // Check if all tasks finished
      const pendingCount = this.taskQueue.getAllTasks().filter(t => t.status !== 'SUCCESS' && t.status !== 'SKIPPED').length;
      if (pendingCount === 0) {
        this.state.status = PROJECT_STATUS.SUCCESS;
        this.state.current_task = null;
        this.checkpoint.saveCheckpoint({
          state: this.state,
          taskQueue: this.taskQueue,
          reason: 'All tasks completed successfully',
          triggerCommit: true
        });
        this.log('ALL TASKS COMPLETED. Project finalized.');
        return { status: 'COMPLETE', active: false };
      }
      // Blocked or waiting on dependencies
      return { status: 'BLOCKED', active: false };
    }

    // 3. Mark task RUNNING
    this.taskQueue.markRunning(task.id, currentWs.id);
    this.state.current_task = task.id;
    this.state.status = PROJECT_STATUS.RUNNING;

    this.log(`Executing ${task.id} (${task.description}) on ${currentWs.id}...`);

    // 4. Build self-contained prompt
    const prompt = PromptBuilder.buildContinuationPrompt({
      projectTitle: this.state.book_title,
      phase: this.state.phase,
      task,
      completedTasks: this.state.completed_tasks,
      pendingTasks: this.state.pending_tasks,
      latestCommit: this.state.last_commit || this.github.getLatestCommitHash()
    });

    // 5. Send prompt to Lovable via selected driver
    try {
      const result = await this.adapter.sendPrompt(prompt, {
        taskId: task.id,
        workspaceId: currentWs.id
      });

      // 6. On success: update task queue & state
      this.taskQueue.markSuccess(task.id, { result: result.output });
      if (!this.state.completed_tasks.includes(task.id)) {
        this.state.completed_tasks.push(task.id);
      }
      this.state.pending_tasks = this.state.pending_tasks.filter(id => id !== task.id);

      // Save post-task checkpoint
      this.checkpoint.saveCheckpoint({
        state: this.state,
        taskQueue: this.taskQueue,
        reason: `Task ${task.id} SUCCESS on ${currentWs.id}`,
        triggerCommit: true
      });

      this.log(`Task ${task.id} succeeded on ${currentWs.id}. Checkpoint saved.`);

      return {
        event: 'TASK_SUCCESS',
        taskId: task.id,
        workspace: currentWs.id,
        active: true
      };
    } catch (error) {
      this.taskQueue.markFailed(task.id, error.message);
      this.log(`Task ${task.id} failed on ${currentWs.id}: ${error.message}`);
      return {
        event: 'TASK_FAILED',
        taskId: task.id,
        error: error.message,
        active: true
      };
    }
  }
}
