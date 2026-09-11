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

  log(message, data = null, eventType = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      event: eventType || 'INFO',
      message,
      data
    };
    this.logs.unshift(entry);
    if (this.logs.length > 250) this.logs.pop();
    if (this.onLog) this.onLog(entry);
  }

  initProject(spec, tasks) {
    this.taskQueue = new TaskQueue(tasks);
    const initialWs = this.workspaces.getNextWorkspace();
    if (!initialWs) throw new Error('No enabled workspaces available in configuration.');

    this.workspaces.markActive(initialWs.id);
    this.state = createInitialState(spec, tasks, initialWs.id);
    this.state.rotation_index = this.workspaces.getRotationIndex(initialWs.id);

    this.checkpoint.saveCheckpoint({
      state: this.state,
      taskQueue: this.taskQueue,
      reason: 'Project initialized',
      triggerCommit: true
    });

    this.log(
      `Project initialized: "${this.state.book_title}" on workspace ${initialWs.id} (${this.taskQueue.getAllTasks().length} tasks)`,
      { spec, workspace: initialWs.id },
      'BOOK_CREATED'
    );
    this.log(`Workspace ${initialWs.id} selected`, { workspace: initialWs.id }, 'WORKSPACE_SELECTED');
    return this.state;
  }

  pause() {
    this.isPaused = true;
    if (this.state) this.state.status = PROJECT_STATUS.PAUSED;
    this.log('Orchestrator paused by user.', null, 'PROJECT_PAUSED');
    return { ok: true, status: 'PAUSED' };
  }

  resume() {
    this.isPaused = false;
    this.isStopped = false;
    if (this.state) this.state.status = PROJECT_STATUS.RUNNING;
    this.log('Orchestrator resumed.', null, 'INFO');
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
    this.log('Orchestrator stopped and checkpoint saved.', null, 'PROJECT_STOPPED');
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
      this.log(
        `Workspace ${currentWs.id} reached legitimate continuation limit. Initiating transition protocol.`,
        { workspace: currentWs.id },
        'WORKSPACE_LIMIT_DETECTED'
      );

      // Step A: Save atomic checkpoint before switching
      this.checkpoint.saveCheckpoint({
        state: this.state,
        taskQueue: this.taskQueue,
        reason: `Workspace ${currentWs.id} limit reached — Handover initiated`,
        triggerCommit: true
      });
      this.log(`Pre-transition checkpoint created for ${currentWs.id}`, null, 'CHECKPOINT_CREATED');

      // Step B: Mark current workspace unavailable for current run
      this.workspaces.markUnavailable(currentWs.id, 'Legitimate limit reached');

      // Step C: Select next enabled workspace in circular order (WS01 -> ... -> WS20 -> WS01)
      const nextWs = this.workspaces.getNextWorkspace(currentWs.id);
      if (!nextWs) {
        this.state.status = PROJECT_STATUS.PAUSED;
        this.log('ALL 20 WORKSPACES UNAVAILABLE FOR CURRENT RUN. Pausing factory safely.', null, 'ALL_WORKSPACES_EXHAUSTED');
        this.checkpoint.saveCheckpoint({
          state: this.state,
          taskQueue: this.taskQueue,
          reason: 'All workspaces exhausted',
          triggerCommit: true
        });
        return { status: 'ALL_WORKSPACES_EXHAUSTED', active: false };
      }

      // Step D: Reconstruct context and preserve current task
      this.log(`Recovering context for transition to ${nextWs.id}`, null, 'RECOVERY_STARTED');
      const recovery = RecoveryEngine.recover(this.state, this.taskQueue.getAllTasks());
      this.state = recovery.recoveredState;
      this.state.last_workspace = currentWs.id;
      this.state.current_workspace = nextWs.id;
      this.state.rotation_index = this.workspaces.getRotationIndex(nextWs.id);
      this.workspaces.markActive(nextWs.id);

      // Post-rotation checkpoint to persist active workspace handoff
      this.checkpoint.saveCheckpoint({
        state: this.state,
        taskQueue: this.taskQueue,
        reason: `Workspace handover from ${currentWs.id} to ${nextWs.id}`,
        triggerCommit: true
      });
      this.log(`Post-transition checkpoint created for ${nextWs.id}`, null, 'CHECKPOINT_CREATED');

      this.log(
        `Transition complete: Handed over from ${currentWs.id} to ${nextWs.id}. Context reconstructed.`,
        { from: currentWs.id, to: nextWs.id, nextTask: recovery.nextTask?.id || null },
        'WORKSPACE_ROTATED'
      );
      this.log(`Recovery completed on ${nextWs.id}`, null, 'RECOVERY_COMPLETED');

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
        this.log('ALL TASKS COMPLETED. Project finalized.', null, 'TASK_COMPLETED');
        return { status: 'COMPLETE', active: false };
      }
      // Blocked or waiting on dependencies
      this.log('Task pipeline blocked on pending dependencies.', null, 'TASK_BLOCKED');
      return { status: 'BLOCKED', active: false };
    }

    // 3. Mark task RUNNING
    this.taskQueue.markRunning(task.id, currentWs.id);
    this.state.current_task = task.id;
    this.state.status = PROJECT_STATUS.RUNNING;

    this.log(`Executing ${task.id} (${task.description}) on ${currentWs.id}...`, { task: task.id, workspace: currentWs.id }, 'TASK_STARTED');

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

      this.log(`Task ${task.id} succeeded on ${currentWs.id}. Checkpoint saved.`, { task: task.id, workspace: currentWs.id }, 'TASK_COMPLETED');

      return {
        event: 'TASK_SUCCESS',
        taskId: task.id,
        workspace: currentWs.id,
        active: true
      };
    } catch (error) {
      // Branch A: Mid-execution legitimate Lovable continuation limit
      if (error.isContinuationLimit) {
        this.log(
          `Legitimate limit reached on ${currentWs.id} during ${task.id}. Initiating mid-task handover.`,
          { task: task.id, workspace: currentWs.id },
          'WORKSPACE_LIMIT_DETECTED'
        );

        // Preserve current task: keep task pending (do not mark failed or increment failure count)
        task.status = 'PENDING';

        this.checkpoint.saveCheckpoint({
          state: this.state,
          taskQueue: this.taskQueue,
          reason: `Workspace ${currentWs.id} limit during ${task.id} — Handover`,
          triggerCommit: true
        });

        this.workspaces.markUnavailable(currentWs.id, 'Legitimate mid-task limit');
        const nextWs = this.workspaces.getNextWorkspace(currentWs.id);

        if (!nextWs) {
          this.state.status = PROJECT_STATUS.PAUSED;
          this.log('ALL 20 WORKSPACES UNAVAILABLE. Pausing factory safely.', null, 'ALL_WORKSPACES_EXHAUSTED');
          return { status: 'ALL_WORKSPACES_EXHAUSTED', active: false };
        }

        this.state.last_workspace = currentWs.id;
        this.state.current_workspace = nextWs.id;
        this.state.rotation_index = this.workspaces.getRotationIndex(nextWs.id);
        this.workspaces.markActive(nextWs.id);

        this.checkpoint.saveCheckpoint({
          state: this.state,
          taskQueue: this.taskQueue,
          reason: `Workspace handover from ${currentWs.id} to ${nextWs.id} (preserved ${task.id})`,
          triggerCommit: true
        });

        this.log(
          `Rotated from ${currentWs.id} to ${nextWs.id}. Task ${task.id} preserved.`,
          { from: currentWs.id, to: nextWs.id, task: task.id },
          'WORKSPACE_ROTATED'
        );

        return {
          event: 'WORKSPACE_TRANSITION',
          from: currentWs.id,
          to: nextWs.id,
          preservedTask: task.id,
          active: true
        };
      }

      // Branch B: Recoverable browser / transport error (DOM missing, navigation, tab disconnected)
      if (error.isBrowserError) {
        task.status = 'PENDING'; // Preserve task for retry
        this.log(
          `Recoverable browser/DOM error on ${currentWs.id} for ${task.id}: ${error.message}. Workspace NOT disabled.`,
          { task: task.id, workspace: currentWs.id, error: error.message },
          'BROWSER_ERROR'
        );
        return {
          event: 'BROWSER_ERROR',
          taskId: task.id,
          workspace: currentWs.id,
          error: error.message,
          active: true
        };
      }

      // Branch C: General task failure
      this.taskQueue.markFailed(task.id, error.message);
      this.log(`Task ${task.id} failed on ${currentWs.id}: ${error.message}`, { task: task.id, error: error.message }, 'TASK_FAILED');
      return {
        event: 'TASK_FAILED',
        taskId: task.id,
        error: error.message,
        active: true
      };
    }
  }
}
