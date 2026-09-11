/**
 * extension/background/service_worker.js
 * Edge extension background service worker hosting the central controller.
 */

import { createDefault15Workspaces } from '../../workspaces/WorkspaceConfig.js';
import { WorkspaceManager } from '../../workspaces/WorkspaceManager.js';
import { TaskQueue } from '../../tasks/TaskQueue.js';
import { createStandardMilestoneTasks } from '../../tasks/TaskDefinitions.js';
import { LovableAdapter } from '../../lovable/LovableAdapter.js';
import { PromptBuilder } from '../../lovable/PromptBuilder.js';
import { createInitialState, PROJECT_STATUS } from '../../state/StateSchema.js';

let activeProject = null;
let workspaceManager = null;
let taskQueue = null;
let adapter = null;
let logs = [];
let isRunning = false;
let isPaused = false;

// Initialize extension behaviors
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
  const stored = await chrome.storage.local.get(['workspaces', 'projectState', 'driverType']);
  const wsList = stored.workspaces || createDefault15Workspaces();
  workspaceManager = new WorkspaceManager(wsList);
  adapter = new LovableAdapter(stored.driverType || 'simulation');
  if (stored.projectState) {
    activeProject = stored.projectState;
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
    workspaces: workspaceManager ? workspaceManager.toJSON() : []
  });
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATED',
    state: activeProject,
    tasks: taskQueue ? taskQueue.getAllTasks() : [],
    workspaces: workspaceManager ? workspaceManager.getAllWorkspaces() : []
  }).catch(() => {});
}

async function runExecutionLoop() {
  if (isRunning) return;
  isRunning = true;

  addLog('Execution loop started', 'info');

  while (isRunning && !isPaused) {
    if (!activeProject || !taskQueue || !workspaceManager) break;

    const currentWs = workspaceManager.getWorkspace(activeProject.current_workspace);
    if (!currentWs) break;

    // 1. Evaluate canContinue
    const canContinue = await adapter.canContinue(currentWs);
    if (!canContinue) {
      addLog(`Workspace ${currentWs.id} limit detected. Initiating rotation handoff.`, 'warn');
      workspaceManager.markUnavailable(currentWs.id);

      const nextWs = workspaceManager.getNextWorkspace(currentWs.id);
      if (!nextWs) {
        addLog('All 15 workspaces are exhausted for this run. Pausing safely.', 'error');
        activeProject.status = PROJECT_STATUS.PAUSED;
        isPaused = true;
        await saveState();
        break;
      }

      activeProject.current_workspace = nextWs.id;
      workspaceManager.markActive(nextWs.id);
      addLog(`Handed over to next enabled workspace: ${nextWs.id}`, 'info');
      await saveState();
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // 2. Fetch next task
    const task = taskQueue.getNextExecutableTask();
    if (!task) {
      const remaining = taskQueue.getAllTasks().filter(t => t.status !== 'SUCCESS').length;
      if (remaining === 0) {
        activeProject.status = PROJECT_STATUS.SUCCESS;
        addLog('All project tasks completed successfully!', 'success');
      }
      isRunning = false;
      await saveState();
      break;
    }

    // 3. Execute task
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
      activeProject.completed_tasks.push(task.id);
      activeProject.pending_tasks = activeProject.pending_tasks.filter(id => id !== task.id);
      addLog(`Task ${task.id} succeeded on ${currentWs.id}.`, 'success');
      await saveState();
    } catch (err) {
      taskQueue.markFailed(task.id, err.message);
      addLog(`Task ${task.id} failed: ${err.message}`, 'error');
      await saveState();
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  isRunning = false;
  await saveState();
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
