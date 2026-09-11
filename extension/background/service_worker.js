/**
 * extension/background/service_worker.js
 * Hardened background service worker supporting 20 Lovable workspaces,
 * circular rotation, task preservation, and restart recovery.
 */

import { createDefault20Workspaces } from '../../workspaces/WorkspaceConfig.js';
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
let initPromise = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = loadInitialConfiguration();
  }
  return initPromise;
}

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  ensureInitialized();
});

// Top-level initialization on every service worker wake-up
ensureInitialized().catch(err => console.error('[ERROR] Service worker initialization failed:', err));

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

  // 1. Workspaces configuration persistence (Strictly 20 slots WS01-WS20)
  const wsList = stored.workspaces && stored.workspaces.length === 20
    ? stored.workspaces
    : createDefault20Workspaces();
  workspaceManager = new WorkspaceManager(wsList);

  // 2. Lovable adapter setup with logging callback
  adapter = new LovableAdapter(stored.driverType || 'simulation', { onLog: addLog });

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
    } else if (stored.factoryStatus === 'STOPPED' || activeProject.status === PROJECT_STATUS.STOPPED) {
      isPaused = false;
      isRunning = false;
      activeProject.status = PROJECT_STATUS.STOPPED;
    } else {
      isPaused = false;
    }

    addLog('State and TaskQueue restored after extension wake/restart.', 'info', 'RECOVERY_COMPLETED');
  }
}

function addLog(message, type = 'info', eventType = 'INFO') {
  const entry = {
    time: new Date().toLocaleTimeString(),
    type,
    event: eventType,
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
    factoryStatus: isPaused ? 'PAUSED' : isRunning ? 'RUNNING' : activeProject?.status || 'IDLE'
  });

  chrome.runtime.sendMessage({
    type: 'STATE_UPDATED',
    state: activeProject,
    tasks: taskQueue ? taskQueue.getAllTasks() : [],
    workspaces: workspaceManager ? workspaceManager.getAllWorkspaces() : []
  }).catch(() => {});
}

async function runExecutionLoop() {
  // Concurrency guard: prevent duplicate loops
  if (executionLock) {
    console.log('[ORCHESTRATOR] Execution lock already held; skipping duplicate runExecutionLoop call.');
    return;
  }
  executionLock = true;
  isRunning = true;
  isPaused = false;

  console.log('[ORCHESTRATOR] execution started');
  addLog('[ORCHESTRATOR] execution started', 'info', 'ORCHESTRATOR');

  if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
    try {
      chrome.alarms.create('factory-watchdog', { periodInMinutes: 1 });
    } catch (e) {}
  }

  try {
    while (isRunning && !isPaused) {
      if (!activeProject || !taskQueue || !workspaceManager) {
        console.warn('[ORCHESTRATOR] Missing activeProject, taskQueue, or workspaceManager. Exiting loop.');
        break;
      }

      const currentWs = workspaceManager.getWorkspace(activeProject.current_workspace);
      if (!currentWs) {
        addLog(`[ERROR] Workspace ${activeProject.current_workspace} not found.`, 'error', 'WORKSPACE_ERROR');
        break;
      }

      addLog(`[WORKSPACE] ${currentWs.id} selected`, 'info', 'WORKSPACE');
      console.log(`[WORKSPACE] ${currentWs.id} selected`);

      // 0. Auto-discovery on first run if workspaces are not yet mapped
      if (!currentWs.mapped && adapter.getDriverName() === 'EdgeBrowserDriver') {
        try {
          addLog('[EDGE] discovering real Workspaces', 'info', 'EDGE');
          const discovered = await adapter.discoverWorkspaces();
          if (Array.isArray(discovered) && discovered.length > 0) {
            const mappedInfo = workspaceManager.applyDiscoveredWorkspaces(discovered);
            addLog(`Discovered ${mappedInfo.mappedCount} real workspaces. Internal mapping active.`, 'success', 'WORKSPACE_MAPPED');
            await saveState();
          }
        } catch (discErr) {
          if (discErr.isAuthError) {
            addLog('[ERROR] Lovable user is not authenticated. Please log in at https://lovable.dev/', 'error', 'AUTH_ERROR');
            activeProject.status = PROJECT_STATUS.PAUSED;
            isPaused = true;
            isRunning = false;
            await saveState();
            break;
          }
          addLog(`[WARN] Workspace auto-discovery skipped: ${discErr.message}`, 'warn', 'WORKSPACE_WARN');
        }
      }

      // 1. Select and verify target workspace in visible Lovable DOM
      try {
        await adapter.selectWorkspace(currentWs);
      } catch (wsSelectErr) {
        if (wsSelectErr.isAuthError) {
          addLog('[ERROR] Lovable authentication required. Pausing factory.', 'error', 'AUTH_ERROR');
          activeProject.status = PROJECT_STATUS.PAUSED;
          isPaused = true;
          isRunning = false;
          await saveState();
          break;
        }
        addLog(`[WARN] Workspace DOM selection warning: ${wsSelectErr.message}`, 'warn', 'WORKSPACE_WARN');
      }

      // 2. Evaluate canContinue capability
      const canContinue = await adapter.canContinue(currentWs);
      if (!canContinue) {
        addLog(`Workspace ${currentWs.id} limit signal detected. Rotating to next workspace.`, 'warn', 'WORKSPACE_LIMIT_DETECTED');
        workspaceManager.markUnavailable(currentWs.id);

        const nextWs = workspaceManager.getNextWorkspace(currentWs.id);
        if (!nextWs) {
          addLog('ALL 20 WORKSPACES UNAVAILABLE FOR CURRENT RUN. Pausing factory safely.', 'error', 'ALL_WORKSPACES_EXHAUSTED');
          activeProject.status = PROJECT_STATUS.PAUSED;
          isPaused = true;
          isRunning = false;
          await saveState();
          break;
        }

        activeProject.last_workspace = currentWs.id;
        activeProject.current_workspace = nextWs.id;
        activeProject.rotation_index = workspaceManager.getRotationIndex(nextWs.id);
        workspaceManager.markActive(nextWs.id);
        addLog(`Handoff complete: active workspace is now ${nextWs.id} (${nextWs.realName || nextWs.name})`, 'info', 'WORKSPACE_ROTATED');
        await saveState();
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // 3. Fetch next executable task
      const task = taskQueue.getNextExecutableTask();
      if (!task) {
        const remaining = taskQueue.getAllTasks().filter(t => t.status !== 'SUCCESS' && t.status !== 'SKIPPED').length;
        if (remaining === 0) {
          activeProject.status = PROJECT_STATUS.SUCCESS;
          activeProject.current_task = null;
          addLog('All tasks successfully completed!', 'success', 'TASK_COMPLETED');
        }
        isRunning = false;
        await saveState();
        break;
      }

      // 4. Mark task RUNNING
      taskQueue.markRunning(task.id, currentWs.id);
      activeProject.current_task = task.id;
      activeProject.status = PROJECT_STATUS.RUNNING;
      await saveState();

      addLog(`[TASK] ${task.id} started: "${task.description}" on ${currentWs.id}...`, 'info', 'TASK');
      console.log(`[TASK] ${task.id} started`);

      const prompt = PromptBuilder.buildContinuationPrompt({
        projectTitle: activeProject.book_title,
        phase: activeProject.phase,
        task,
        completedTasks: activeProject.completed_tasks,
        pendingTasks: activeProject.pending_tasks
      });

      addLog(`[LOVABLE] adapter invoked with driver: ${adapter.getDriverName()}`, 'info', 'LOVABLE');
      console.log(`[LOVABLE] adapter invoked with driver: ${adapter.getDriverName()}`);

      try {
        const result = await adapter.sendPrompt(prompt, {
          taskId: task.id,
          workspaceId: currentWs.id,
          workspace: currentWs,
          realName: currentWs.realName,
          projectName: activeProject.target_project || null
        });

        taskQueue.markSuccess(task.id, { output: result.output });
        if (!activeProject.completed_tasks.includes(task.id)) {
          activeProject.completed_tasks.push(task.id);
        }
        activeProject.pending_tasks = activeProject.pending_tasks.filter(id => id !== task.id);
        addLog(`Task ${task.id} succeeded on ${currentWs.id}.`, 'success', 'TASK_COMPLETED');
        console.log(`Task ${task.id} succeeded on ${currentWs.id}.`);
        await saveState();
      } catch (err) {
        console.error(`[ERROR] Task execution error on ${currentWs.id}:`, err);

        if (err.isContinuationLimit) {
          addLog(`Legitimate limit reached on ${currentWs.id} during ${task.id}. Preserving task and rotating.`, 'warn', 'WORKSPACE_LIMIT_DETECTED');
          task.status = 'PENDING'; // Preserve task
          workspaceManager.markUnavailable(currentWs.id);

          const nextWs = workspaceManager.getNextWorkspace(currentWs.id);
          if (!nextWs) {
            addLog('ALL 20 WORKSPACES UNAVAILABLE. Pausing safely.', 'error', 'ALL_WORKSPACES_EXHAUSTED');
            activeProject.status = PROJECT_STATUS.PAUSED;
            isPaused = true;
            isRunning = false;
            await saveState();
            break;
          }

          activeProject.last_workspace = currentWs.id;
          activeProject.current_workspace = nextWs.id;
          activeProject.rotation_index = workspaceManager.getRotationIndex(nextWs.id);
          workspaceManager.markActive(nextWs.id);
          addLog(`Rotated to ${nextWs.id} (${nextWs.realName || nextWs.name}). Task ${task.id} preserved.`, 'info', 'WORKSPACE_ROTATED');
          await saveState();
          continue;
        }

        if (err.isBrowserError) {
          task.status = 'PENDING'; // Preserve task for retry
          addLog(`[ERROR] Browser transport/DOM error on ${currentWs.id}: ${err.message}. Workspace NOT disabled.`, 'warn', 'BROWSER_ERROR');
          // Pause execution safely so user can address browser state without infinite retry churn
          isPaused = true;
          isRunning = false;
          if (activeProject) activeProject.status = PROJECT_STATUS.PAUSED;
          await saveState();
          break;
        }

        taskQueue.markFailed(task.id, err.message);
        addLog(`[ERROR] Task ${task.id} failed: ${err.message}`, 'error', 'TASK_FAILED');
        await saveState();
      }

      await new Promise(r => setTimeout(r, 1000));
    }
  } finally {
    isRunning = false;
    executionLock = false;
    if (typeof chrome !== 'undefined' && chrome.alarms?.clear) {
      try {
        chrome.alarms.clear('factory-watchdog');
      } catch (e) {}
    }
    await saveState();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    try {
      await ensureInitialized();

      switch (msg.type) {
        case 'GET_DATA':
          respond({
            state: activeProject,
            tasks: taskQueue ? taskQueue.getAllTasks() : [],
            workspaces: workspaceManager ? workspaceManager.getAllWorkspaces() : [],
            isExhausted: workspaceManager ? workspaceManager.isExhausted() : false,
            logs,
            driverType: adapter?.driverType || 'browser',
            isRunning,
            isPaused
          });
          break;

        case 'START_PROJECT': {
          console.log('[CREATE_BOOK] message received by service worker:', msg);

          // Configure driver
          const targetDriver = msg.driverType || 'browser';
          adapter.setDriver(targetDriver, { onLog: addLog });
          await chrome.storage.local.set({ driverType: targetDriver });

          addLog(`ACTIVE_DRIVER = ${adapter.getDriverName()}`, 'info', 'DRIVER_SELECTED');
          addLog(`ACTUAL_DRIVER = ${adapter.getDriverName()}`, 'info', 'DRIVER_SELECTED');
          console.log(`ACTIVE_DRIVER = ${adapter.getDriverName()}`);
          console.log(`ACTUAL_DRIVER = ${adapter.getDriverName()}`);

          const pageCount = Number(msg.spec?.page_count) || Number(msg.spec?.pages) || 1;
          const tasks = createStandardMilestoneTasks(pageCount);

          activeProject = createInitialState(msg.spec, tasks, 'WS01');
          activeProject.status = PROJECT_STATUS.RUNNING;
          activeProject.rotation_index = 1;
          if (msg.targetProject) {
            activeProject.target_project = msg.targetProject;
          }
          taskQueue = new TaskQueue(tasks);

          isPaused = false;
          // Notice: do NOT set isRunning = true before runExecutionLoop acquires executionLock!

          addLog('[CREATE_BOOK] state persisted', 'info', 'CREATE_BOOK');
          addLog('[CREATE_BOOK] task queue created', 'info', 'CREATE_BOOK');
          addLog('[CREATE_BOOK] orchestrator initialized', 'info', 'CREATE_BOOK');
          addLog(`Book project created: "${activeProject.book_title}" (${pageCount} coloring pages)`, 'info', 'BOOK_CREATED');

          await saveState();

          // Respond immediately to dashboard so UI updates
          respond({ ok: true, state: activeProject, driver: adapter.getDriverName() });

          // Start execution loop
          runExecutionLoop().catch(err => {
            console.error('[ERROR] Unhandled error in runExecutionLoop:', err);
            addLog(`[ERROR] Unhandled runExecutionLoop error: ${err.message}`, 'error', 'TASK_FAILED');
          });
          break;
        }

        case 'PAUSE_PROJECT':
          isPaused = true;
          isRunning = false;
          if (activeProject) activeProject.status = PROJECT_STATUS.PAUSED;
          addLog('Factory paused by user', 'warn', 'PROJECT_PAUSED');
          await saveState();
          respond({ ok: true });
          break;

        case 'RESUME_PROJECT':
          isPaused = false;
          if (activeProject) activeProject.status = PROJECT_STATUS.RUNNING;
          addLog('Factory resumed', 'info', 'INFO');
          await saveState();
          runExecutionLoop().catch(() => {});
          respond({ ok: true });
          break;

        case 'STOP_PROJECT':
          isPaused = false;
          isRunning = false;
          if (activeProject) activeProject.status = PROJECT_STATUS.STOPPED;
          addLog('Factory stopped', 'error', 'PROJECT_STOPPED');
          await saveState();
          respond({ ok: true });
          break;

        case 'RESET_TEST_RUN':
          isPaused = false;
          isRunning = false;
          activeProject = null;
          taskQueue = null;
          if (workspaceManager) workspaceManager.resetRunStatuses();
          logs = [];
          await chrome.storage.local.remove(['projectState', 'taskQueue', 'factoryStatus']);
          await chrome.storage.local.set({ workspaces: workspaceManager ? workspaceManager.toJSON() : [] });
          addLog('Factory test run reset safely. Canonical Git history preserved.', 'info', 'INFO');
          respond({ ok: true });
          break;

        case 'SET_DRIVER':
          adapter.setDriver(msg.driverType, { onLog: addLog, ...(msg.options || {}) });
          await chrome.storage.local.set({ driverType: msg.driverType });
          addLog(`ACTIVE_DRIVER = ${adapter.getDriverName()}`, 'info', 'DRIVER_SELECTED');
          addLog(`ACTUAL_DRIVER = ${adapter.getDriverName()}`, 'info', 'DRIVER_SELECTED');
          respond({ ok: true, driver: adapter.getDriverName() });
          break;

        case 'UPDATE_WORKSPACES':
          workspaceManager = new WorkspaceManager(msg.workspaces);
          await chrome.storage.local.set({ workspaces: msg.workspaces });
          addLog('20-Workspace configuration updated', 'info', 'INFO');
          respond({ ok: true });
          break;

        case 'DISCOVER_WORKSPACES': {
          addLog('[EDGE] discovering real Workspaces', 'info', 'EDGE');
          try {
            const discovered = await adapter.discoverWorkspaces();
            if (Array.isArray(discovered) && discovered.length > 0) {
              const mappedInfo = workspaceManager.applyDiscoveredWorkspaces(discovered);
              addLog(`Discovered ${mappedInfo.mappedCount} real workspaces. Internal mapping active.`, 'success', 'WORKSPACE_MAPPED');
              await saveState();
              respond({
                ok: true,
                mappedCount: mappedInfo.mappedCount,
                workspaces: workspaceManager.getAllWorkspaces()
              });
            } else {
              respond({
                ok: false,
                error: 'No real workspaces discovered. Please ensure Lovable is open and authenticated in Edge.'
              });
            }
          } catch (discErr) {
            addLog(`[ERROR] Workspace discovery error: ${discErr.message}`, 'error', 'WORKSPACE_ERROR');
            respond({ ok: false, error: discErr.message });
          }
          break;
        }

        default:
          respond({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    } catch (msgErr) {
      console.error('[ERROR] onMessage error:', msgErr);
      addLog(`[ERROR] Service worker message error: ${msgErr.message}`, 'error', 'ERROR');
      respond({ ok: false, error: msgErr.message });
    }
  })();
  return true;
});

// Watchdog alarm handler for MV3 lifecycle resilience
if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'factory-watchdog') {
      await ensureInitialized();
      if (activeProject && activeProject.status === PROJECT_STATUS.RUNNING && !isPaused && !isRunning && !executionLock) {
        console.log('[WATCHDOG] Resuming execution after service worker wake-up');
        runExecutionLoop().catch(() => {});
      }
    }
  });
}

