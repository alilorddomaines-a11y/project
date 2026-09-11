/**
 * extension/background/service_worker.js
 * Hardened background service worker with concurrency locks and restart recovery.
 */

import { createDefault15Workspaces } from '../../workspaces/WorkspaceConfig.js';
import { WorkspaceManager } from '../../workspaces/WorkspaceManager.js';
import { TaskQueue } from '../../tasks/TaskQueue.js';
import { createStandardMilestoneTasks } from '../../tasks/TaskDefinitions.js';
import { LovableAdapter } from '../../lovable/LovableAdapter.js';
import { PromptBuilder } from '../../lovable/PromptBuilder.js';
import { RecoveryEngine } from '../../state/RecoveryEngine.js';
import { createInitialState, PROJECT_STATUS } from '../../state/StateSchema.js';

let activeProject = null;
let workspaceManager = null;
let taskQueue = null;
let adapter = null;
let logs = [];
let isRunning = false;
let isPaused = false;
let executionLock = false; // Concurrency guard against duplicate loops

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  loadInitialConfiguration();
});

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel?.open) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

async function loadInitialConfiguration() {
  const stored = await chrome.storage.local.get([
    'workspaces',
    'projectState',
    'taskQueue',
    'driverType',
    'factoryStatus'
  ]);

  // 1. Workspaces configuration persistence
  const wsList = stored.workspaces && stored.workspaces.length === 15
    ? stored.workspaces
    : createDefault15Workspaces();
  workspaceManager = new WorkspaceManager(wsList);

  // 2. Lovable adapter setup
  adapter = new LovableAdapter(stored.driverType || 'simulation');

  // 3. TaskQueue and ProjectState restoration
  if (stored.projectState && stored.taskQueue) {
    activeProject = stored.projectState;
    taskQueue = TaskQueue.fromJSON(stored.taskQueue);

    // Concurrency / crash recovery: handle any interrupted RUNNING task
    const recovered = RecoveryEngine.reconstruct(activeProject, taskQueue.getAllTasks(), 'EXTENSION_RESTART');
    activeProject = recovered.recoveredState;
    taskQueue = new TaskQueue(recovered.tasks);

    if (stored.factoryStatus === 'PAUSED' || activeProject.status === PROJECT_STATUS.PAUSED) {
      isPaused = true;
      isRunning = false;
      activeProject.status = PROJECT_STATUS.PAUSED;
    } else {
      isPaused = false;
    }

    addLog('State and TaskQueue restored after extension wake/restart.', 'info');
  }
}

function addLog(message, type = 'info') {
  const entry = {
    time: new Date().toLocaleTimeString(),
    type,
    message
  };
  logs.unshift(entry);
  if (logs.length > 250) logs.pop();
  chrome.runtime.sendMessage({ type: 'LOG_APPENDED', entry }).catch(() => {});
}

async function saveState() {
  await chrome.storage.local.set({
    projectState: activeProject,
    taskQueue: taskQueue ? taskQueue.toJSON() : [],
    workspaces: workspaceManager ? workspaceManager.toJSON() : [],
    factoryStatus: isPaused ? 'PAUSED' : isRunning ? 'RUNNING' : 'IDLE'
  });

  chrome.runtime.sendMessage({
    type: 'STATE_UPDATED',
    state: activeProject,
    tasks: taskQueue ? taskQueue.getAllTasks() : [],
    workspaces: workspaceManager ? workspaceManager.getAllWorkspaces() : []
  }).catch(() => {});
}

async function runExecutionLoop() {
  // Concurrency lock prevents duplicate loops
  if (executionLock || isRunning) return;
  executionLock = true;
  isRunning = true;

  addLog('Execution loop acquired lock and started.', 'info');

  try {
    while (isRunning && !isPaused) {
      if (!activeProject || !taskQueue || !workspaceManager) break;

      const currentWs = workspaceManager.getWorkspace(activeProject.current_workspace);
      if (!currentWs) break;

      // 1. Evaluate canContinue
      const canContinue = await adapter.canContinue(currentWs);
      if (!canContinue) {
        addLog(`Workspace ${currentWs.id} limit signal detected. Rotating to next workspace.`, 'warn');
        workspaceManager.markUnavailable(currentWs.id);

        const nextWs = workspaceManager.getNextWorkspace(currentWs.id);
        if (!nextWs) {
          addLog('All 15 workspaces unavailable for this run. Pausing safely.', 'error');
          activeProject.status = PROJECT_STATUS.PAUSED;
          isPaused = true;
          await saveState();
          break;
        }

        activeProject.current_workspace = nextWs.id;
        workspaceManager.markActive(nextWs.id);
        addLog(`Handoff complete: active workspace is now ${nextWs.id}`, 'info');
        await saveState();
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // 2. Fetch next executable task
      const task = taskQueue.getNextExecutableTask();
      if (!task) {
        const remaining = taskQueue.getAllTasks().filter(t => t.status !== 'SUCCESS' && t.status !== 'SKIPPED').length;
        if (remaining === 0) {
          activeProject.status = PROJECT_STATUS.SUCCESS;
          addLog('All tasks successfully completed!', 'success');
        }
        isRunning = false;
        await saveState();
        break;
      }

      // 3. Mark task RUNNING
      taskQueue.markRunning(task.id, currentWs.id);
      activeProject.current_task = task.id;
      activeProject.status = PROJECT_STATUS.RUNNING;
      await saveState();

      addLog(`Running ${task.id}: "${task.description}" on ${currentWs.id}...`, 'info');

      const prompt = PromptBuilder.buildContinuationPrompt({
        projectTitle: activeProject.book_title,
        phase: activeProject.phase,
        task,
        completedTasks: activeProject.completed_tasks,
        pendingTasks: activeProject.pending_tasks
      });

      try {
        const result = await adapter.sendPrompt(prompt, { taskId: task.id, workspaceId: currentWs.id });
        taskQueue.markSuccess(task.id, { output: result.output });
        if (!activeProject.completed_tasks.includes(task.id)) {
          activeProject.completed_tasks.push(task.id);
        }
        activeProject.pending_tasks = activeProject.pending_tasks.filter(id => id !== task.id);
        addLog(`Task ${task.id} succeeded on ${currentWs.id}.`, 'success');
        await saveState();
      } catch (err) {
        taskQueue.markFailed(task.id, err.message);
        addLog(`Task ${task.id} failed: ${err.message}`, 'error');
        await saveState();
      }

      await new Promise(r => setTimeout(r, 1000));
    }
  } finally {
    isRunning = false;
    executionLock = false;
    await saveState();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    if (!workspaceManager) await loadInitialConfiguration();

    switch (msg.type) {
      case 'GET_DATA':
        respond({
          state: activeProject,
          tasks: taskQueue ? taskQueue.getAllTasks() : [],
          workspaces: workspaceManager ? workspaceManager.getAllWorkspaces() : [],
          logs,
          driverType: adapter?.driverType || 'simulation',
          isRunning,
          isPaused
        });
        break;

      case 'START_PROJECT':
        activeProject = createInitialState(msg.spec, createStandardMilestoneTasks(msg.spec.pages || 10), 'WS01');
        taskQueue = new TaskQueue(createStandardMilestoneTasks(msg.spec.pages || 10));
        isPaused = false;
        await saveState();
        runExecutionLoop();
        respond({ ok: true, state: activeProject });
        break;

      case 'PAUSE_PROJECT':
        isPaused = true;
        isRunning = false;
        if (activeProject) activeProject.status = PROJECT_STATUS.PAUSED;
        addLog('Factory paused by user', 'warn');
        await saveState();
        respond({ ok: true });
        break;

      case 'RESUME_PROJECT':
        isPaused = false;
        if (activeProject) activeProject.status = PROJECT_STATUS.RUNNING;
        addLog('Factory resumed', 'info');
        await saveState();
        runExecutionLoop();
        respond({ ok: true });
        break;

      case 'STOP_PROJECT':
        isPaused = false;
        isRunning = false;
        if (activeProject) activeProject.status = PROJECT_STATUS.STOPPED;
        addLog('Factory stopped', 'error');
        await saveState();
        respond({ ok: true });
        break;

      case 'SET_DRIVER':
        adapter.setDriver(msg.driverType, msg.options || {});
        await chrome.storage.local.set({ driverType: msg.driverType });
        addLog(`Driver switched to: ${adapter.getDriverName()}`, 'info');
        respond({ ok: true, driver: adapter.getDriverName() });
        break;

      case 'UPDATE_WORKSPACES':
        workspaceManager = new WorkspaceManager(msg.workspaces);
        await chrome.storage.local.set({ workspaces: msg.workspaces });
        addLog('15-Workspace configuration updated', 'info');
        respond({ ok: true });
        break;

      default:
        respond({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;
});
