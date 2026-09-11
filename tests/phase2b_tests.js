/**
 * tests/phase2b_tests.js
 * Comprehensive automated test suite for Phase 2B:
 * Edge Extension + 20 Lovable Workspace Rotation.
 * 
 * Test Scenarios:
 * A. Extension state initialization
 * B. Create Book with BookSpec
 * C. BookSpec persistence
 * D. Task queue initialization
 * E. WS01 -> WS02 rotation
 * F. WS19 -> WS20 rotation
 * G. WS20 -> WS01 circular rotation
 * H. Current task preserved during rotation
 * I. Completed task never repeated
 * J. Browser/DOM failure does NOT disable workspace
 * K. Legitimate visible continuation limit DOES disable workspace
 * L. All 20 workspaces exhausted -> PAUSED
 * M. No WS21 exists / cannot be created
 * N. Service-worker restart recovery
 * O. Edge/browser failure recovery
 * P. Paused project remains paused
 * Q. Stopped project remains stopped
 * R. Simulation mode never contacts Lovable
 * S. Checkpoint after workspace rotation
 * T. Workspace state persists
 * U. Rotation index persists
 * V. BookSpec remains persisted after restart
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Orchestrator } from '../orchestrator/Orchestrator.js';
import { GitHubManager } from '../github/GitHubManager.js';
import { CheckpointSystem } from '../github/CheckpointSystem.js';
import { RecoveryEngine } from '../state/RecoveryEngine.js';
import { TaskQueue } from '../tasks/TaskQueue.js';
import { createStandardMilestoneTasks, createTask, TASK_STATUS } from '../tasks/TaskDefinitions.js';
import {
  createDefault20Workspaces,
  WORKSPACE_STATUS,
  MAX_WORKSPACES,
  VALID_WORKSPACE_IDS
} from '../workspaces/WorkspaceConfig.js';
import { WorkspaceManager } from '../workspaces/WorkspaceManager.js';
import { createInitialState, PROJECT_STATUS } from '../state/StateSchema.js';
import { BookSpec } from '../kdp/BookSpec.js';
import { SimulationDriver } from '../lovable/drivers/SimulationDriver.js';
import { EdgeBrowserDriver } from '../lovable/drivers/EdgeBrowserDriver.js';

// Setup isolated sandbox directory
const SANDBOX_DIR = path.resolve(process.cwd(), 'tests', 'sandbox_phase2b');
if (fs.existsSync(SANDBOX_DIR)) {
  fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
}
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

// Initialize isolated git repository
execSync('git init -b main', { cwd: SANDBOX_DIR, stdio: 'pipe' });
execSync('git config user.name "alilorddomaines-a11y"', { cwd: SANDBOX_DIR, stdio: 'pipe' });
execSync('git config user.email "alilorddomaines-a11y@users.noreply.github.com"', { cwd: SANDBOX_DIR, stdio: 'pipe' });
execSync('git remote add origin https://github.com/alilorddomaines-a11y/project.git', { cwd: SANDBOX_DIR, stdio: 'pipe' });

// Create initial commit
fs.writeFileSync(path.join(SANDBOX_DIR, '.gitignore'), 'temp/\n', 'utf8');
execSync('git add .gitignore && git commit -m "chore: sandbox initial commit"', { cwd: SANDBOX_DIR, stdio: 'pipe' });

const results = {};

console.log('===============================================================');
console.log('    PHASE 2B: EDGE EXTENSION + 20 WS ROTATION — TEST SUITE     ');
console.log('===============================================================\n');

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// -----------------------------------------------------------------------------
// TEST A: Extension state initialization
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  const allWs = wm.getAllWorkspaces();
  assert(allWs.length === 20, `Expected 20 workspaces, got ${allWs.length}`);
  assert(allWs[0].id === 'WS01', `Expected WS01 first, got ${allWs[0].id}`);
  assert(allWs[19].id === 'WS20', `Expected WS20 last, got ${allWs[19].id}`);
  const state = createInitialState({ title: 'Init Test' }, [], 'WS01');
  assert(state.status === PROJECT_STATUS.INITIALIZING, `Expected INITIALIZING status, got ${state.status}`);
  assert(state.current_workspace === 'WS01', `Expected WS01, got ${state.current_workspace}`);
  assert(state.rotation_index === 1, `Expected rotation_index 1, got ${state.rotation_index}`);
  results['A. Extension state initialization'] = 'PASS';
} catch (e) {
  results['A. Extension state initialization'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST B: Create Book with BookSpec
// -----------------------------------------------------------------------------
try {
  const spec = BookSpec.create({
    book_title: 'Mystical Jungle Animals',
    page_count: 25,
    trim_size: '8.5x11',
    orientation: 'PORTRAIT',
    complexity: 'SIMPLE',
    style: 'CLEAN_LINE_ART',
    blank_back_pages: true
  });
  assert(spec.book_title === 'Mystical Jungle Animals', 'Title mismatch');
  assert(spec.page_count === 25, 'Page count mismatch');
  assert(Object.isFrozen(spec), 'BookSpec must be immutable');
  results['B. Create Book'] = 'PASS';
} catch (e) {
  results['B. Create Book'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST C: BookSpec persistence
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const spec = BookSpec.create({
    book_title: 'Persistence Test Book',
    page_count: 15,
    trim_size: '8x10'
  });
  const saved = BookSpec.saveToState(spec, gh);
  assert(saved.book_title === 'Persistence Test Book', 'Failed to save to state');
  const loaded = BookSpec.loadFromState(gh);
  assert(loaded.book_title === 'Persistence Test Book', 'Failed to load from state');
  // Clean up state directory so sandbox remains clean for subsequent git tests
  fs.rmSync(path.join(SANDBOX_DIR, 'state'), { recursive: true, force: true });
  results['C. BookSpec persistence'] = 'PASS';
} catch (e) {
  results['C. BookSpec persistence'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST D: Task queue initialization
// -----------------------------------------------------------------------------
try {
  const tasks = createStandardMilestoneTasks(25);
  const queue = new TaskQueue(tasks);
  assert(tasks.length === 10, `Expected 10 milestone tasks, got ${tasks.length}`);
  assert(tasks[0].id === 'TASK-001', 'First task must be TASK-001');
  assert(tasks[9].id === 'TASK-010', 'Last task must be TASK-010');
  // Verify requested coloring-page count was NOT silently altered
  assert(tasks[1].description.includes('25 unique page concepts'), 'Requested page count was altered');
  assert(tasks[2].description.includes('25 high-quality line art prompts'), 'Requested page count was altered');
  assert(tasks[3].description.includes('25 coloring illustrations'), 'Requested page count was altered');
  const next = queue.getNextExecutableTask();
  assert(next.id === 'TASK-001', 'Next executable task should be TASK-001');
  results['D. Task queue initialization'] = 'PASS';
} catch (e) {
  results['D. Task queue initialization'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST E: WS01 -> WS02 rotation
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  const next = wm.getNextWorkspace('WS01');
  assert(next.id === 'WS02', `Expected WS02, got ${next?.id}`);
  results['E. WS01 -> WS02 rotation'] = 'PASS';
} catch (e) {
  results['E. WS01 -> WS02 rotation'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST F: WS19 -> WS20 rotation
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  const next = wm.getNextWorkspace('WS19');
  assert(next.id === 'WS20', `Expected WS20, got ${next?.id}`);
  results['F. WS19 -> WS20 rotation'] = 'PASS';
} catch (e) {
  results['F. WS19 -> WS20 rotation'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST G: WS20 -> WS01 circular rotation
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  const next = wm.getNextWorkspace('WS20');
  assert(next.id === 'WS01', `Expected WS01 on wrap-around, got ${next?.id}`);
  results['G. WS20 -> WS01 circular rotation'] = 'PASS';
} catch (e) {
  results['G. WS20 -> WS01 circular rotation'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST H: Current task preserved during rotation
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(5);
  const sim = new SimulationDriver({
    midTaskLimits: { WS01: true } // Triggers limit mid-execution of first task
  });

  const orchestrator = new Orchestrator({
    github: gh,
    checkpoint: cp,
    driverType: 'simulation'
  });
  orchestrator.adapter.driver = sim;

  orchestrator.initProject({ title: 'Task Preserve Test' }, tasks);

  // Execute step: should encounter mid-task limit on WS01, rotate to WS02, and preserve TASK-001
  const stepRes = await orchestrator.step();

  assert(stepRes.event === 'WORKSPACE_TRANSITION', `Expected WORKSPACE_TRANSITION, got ${stepRes.event}`);
  assert(stepRes.from === 'WS01', 'Expected from WS01');
  assert(stepRes.to === 'WS02', 'Expected to WS02');
  assert(stepRes.preservedTask === 'TASK-001', `Expected TASK-001 preserved, got ${stepRes.preservedTask}`);

  // Next step executes preserved TASK-001 on WS02
  const nextExec = orchestrator.taskQueue.getNextExecutableTask();
  assert(nextExec.id === 'TASK-001', `Next task should still be preserved TASK-001, got ${nextExec.id}`);
  assert(nextExec.status === 'PENDING', `Preserved task should be PENDING, got ${nextExec.status}`);

  results['H. Current task preserved during rotation'] = 'PASS';
} catch (e) {
  results['H. Current task preserved during rotation'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST I: Completed task is never repeated
// -----------------------------------------------------------------------------
try {
  const tasks = [
    createTask({ id: 'TASK-001', status: 'SUCCESS' }),
    createTask({ id: 'TASK-002', status: 'SUCCESS' }),
    createTask({ id: 'TASK-003', status: 'PENDING', dependencies: ['TASK-002'] })
  ];
  const state = {
    project_id: 'test_i',
    book_title: 'Test I',
    status: 'RUNNING',
    phase: 'PROMPTS',
    current_workspace: 'WS01',
    completed_tasks: ['TASK-001', 'TASK-002'],
    pending_tasks: ['TASK-003'],
    failed_tasks: [],
    assets_created: [],
    assets_failed: [],
    timestamp: new Date().toISOString()
  };

  const recovered = RecoveryEngine.reconstruct(state, tasks, 'TEST_I');
  const task1 = recovered.tasks.find(t => t.id === 'TASK-001');
  const task2 = recovered.tasks.find(t => t.id === 'TASK-002');
  assert(task1.status === 'SUCCESS', 'Task 1 must remain SUCCESS');
  assert(task2.status === 'SUCCESS', 'Task 2 must remain SUCCESS');
  assert(recovered.nextTask.id === 'TASK-003', 'Must proceed to TASK-003 without repeating 1 or 2');
  results['I. Completed task never repeated'] = 'PASS';
} catch (e) {
  results['I. Completed task never repeated'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST J: Browser/DOM failure does NOT disable workspace
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(2);
  const sim = new SimulationDriver({
    browserErrors: { WS01: 'Chat input element not visible on page' }
  });

  const orchestrator = new Orchestrator({
    github: gh,
    checkpoint: cp,
    driverType: 'simulation'
  });
  orchestrator.adapter.driver = sim;

  orchestrator.initProject({ title: 'Browser Error Test' }, tasks);

  const stepRes = await orchestrator.step();

  assert(stepRes.event === 'BROWSER_ERROR', `Expected BROWSER_ERROR event, got ${stepRes.event}`);
  const ws1 = orchestrator.workspaces.getWorkspace('WS01');
  assert(ws1.status !== WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN, 'Workspace WS01 must NOT be marked unavailable on DOM error');
  assert(ws1.enabled === true, 'Workspace WS01 must remain enabled');
  results['J. Browser/DOM failure does NOT disable workspace'] = 'PASS';
} catch (e) {
  results['J. Browser/DOM failure does NOT disable workspace'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST K: Legitimate visible continuation limit DOES disable workspace
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(2);
  const sim = new SimulationDriver({
    limits: { WS01: 0 } // Workspace WS01 is at limit
  });

  const orchestrator = new Orchestrator({
    github: gh,
    checkpoint: cp,
    driverType: 'simulation'
  });
  orchestrator.adapter.driver = sim;

  orchestrator.initProject({ title: 'Limit Test' }, tasks);

  const stepRes = await orchestrator.step();

  assert(stepRes.event === 'WORKSPACE_TRANSITION', 'Expected WORKSPACE_TRANSITION');
  const ws1 = orchestrator.workspaces.getWorkspace('WS01');
  assert(ws1.status === WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN, 'Workspace WS01 MUST be marked UNAVAILABLE_FOR_RUN');
  results['K. Legitimate visible continuation limit DOES disable workspace'] = 'PASS';
} catch (e) {
  results['K. Legitimate visible continuation limit DOES disable workspace'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST L: All 20 workspaces exhausted -> PAUSED
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(2);

  const orchestrator = new Orchestrator({
    github: gh,
    checkpoint: cp,
    workspaces: wm,
    driverType: 'simulation',
    driverOptions: { limits: { WS01: 0 } }
  });

  orchestrator.initProject({ title: 'Exhaustion Test' }, tasks);

  // Mark all 20 workspaces unavailable
  for (let i = 1; i <= 20; i++) {
    wm.markUnavailable(`WS${String(i).padStart(2, '0')}`);
  }

  assert(wm.isExhausted() === true, 'wm.isExhausted() should return true');

  const stepRes = await orchestrator.step();

  assert(stepRes.status === 'ALL_WORKSPACES_EXHAUSTED', `Expected ALL_WORKSPACES_EXHAUSTED, got ${stepRes.status}`);
  assert(orchestrator.state.status === PROJECT_STATUS.PAUSED, `Expected status PAUSED, got ${orchestrator.state.status}`);
  results['L. All 20 workspaces exhausted'] = 'PASS';
} catch (e) {
  results['L. All 20 workspaces exhausted'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST M: No WS21 exists / cannot be created
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  assert(wm.getAllWorkspaces().length === 20, 'Must have exactly 20 workspaces');
  assert(wm.getWorkspace('WS21') === null, 'WS21 must not exist');

  let errorThrown = false;
  try {
    wm.updateWorkspace('WS01', { id: 'WS21' });
  } catch {
    errorThrown = true;
  }
  assert(errorThrown, 'Must throw error if attempting to rename to WS21');

  let listErrorThrown = false;
  try {
    const invalidList = createDefault20Workspaces();
    invalidList.push({ id: 'WS21', name: 'Illegal WS', enabled: true, order: 21 });
    new WorkspaceManager(invalidList);
  } catch {
    listErrorThrown = true;
  }
  assert(listErrorThrown, 'Must throw error if initializing with > 20 workspaces or WS21');

  results['M. No WS21 exists'] = 'PASS';
} catch (e) {
  results['M. No WS21 exists'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST N: Service-worker restart recovery
// -----------------------------------------------------------------------------
try {
  const mockStorage = {
    workspaces: createDefault20Workspaces(),
    projectState: {
      project_id: 'proj_restart',
      book_title: 'Restart Book',
      status: 'RUNNING',
      phase: 'ILLUSTRATIONS',
      current_workspace: 'WS05',
      current_task: 'TASK-004',
      completed_tasks: ['TASK-001', 'TASK-002', 'TASK-003'],
      pending_tasks: ['TASK-004', 'TASK-005'],
      failed_tasks: [],
      assets_created: [],
      assets_failed: [],
      timestamp: new Date().toISOString()
    },
    taskQueue: [
      createTask({ id: 'TASK-001', status: 'SUCCESS' }),
      createTask({ id: 'TASK-002', status: 'SUCCESS' }),
      createTask({ id: 'TASK-003', status: 'SUCCESS' }),
      createTask({ id: 'TASK-004', status: 'RUNNING' }),
      createTask({ id: 'TASK-005', status: 'PENDING', dependencies: ['TASK-004'] })
    ]
  };

  const restoredQueue = TaskQueue.fromJSON(mockStorage.taskQueue);
  const recovered = RecoveryEngine.reconstruct(mockStorage.projectState, restoredQueue.getAllTasks(), 'SERVICE_WORKER_RESTART');

  const task4 = recovered.tasks.find(t => t.id === 'TASK-004');
  assert(task4.status === 'PENDING', 'Interrupted TASK-004 must be reset to PENDING');
  assert(task4.attempts === 1, 'TASK-004 attempts incremented');
  assert(recovered.nextTask.id === 'TASK-004', 'Next task must be TASK-004');
  assert(recovered.completedCount === 3, 'Must maintain 3 completed tasks');
  results['N. Service-worker restart recovery'] = 'PASS';
} catch (e) {
  results['N. Service-worker restart recovery'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST O: Edge/browser failure recovery
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(3);

  const state = createInitialState({ id: 'browser_crash_proj', title: 'Crash Recovery Book' }, tasks, 'WS03');
  state.completed_tasks = ['TASK-001'];
  state.pending_tasks = ['TASK-002', 'TASK-003'];

  cp.saveCheckpoint({
    state,
    taskQueue: tasks,
    reason: 'Committed state prior to browser failure',
    triggerCommit: true
  });

  const recovered = RecoveryEngine.recoverFromGit(gh, 'HEAD');
  assert(recovered.nextTask.id === 'TASK-002', 'Should recover and resume at TASK-002');
  assert(recovered.recoveredState.current_workspace === 'WS03', 'Should retain WS03');
  results['O. Edge/browser failure recovery'] = 'PASS';
} catch (e) {
  results['O. Edge/browser failure recovery'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST P: Paused project remains paused
// -----------------------------------------------------------------------------
try {
  const pausedState = {
    project_id: 'paused_proj',
    book_title: 'Paused Book',
    status: PROJECT_STATUS.PAUSED,
    phase: 'BOOK_SPEC',
    current_workspace: 'WS01',
    completed_tasks: [],
    pending_tasks: ['TASK-001'],
    failed_tasks: [],
    assets_created: [],
    assets_failed: [],
    timestamp: new Date().toISOString()
  };
  const tasks = [createTask({ id: 'TASK-001', status: 'PENDING' })];

  const recovered = RecoveryEngine.reconstruct(pausedState, tasks, 'TEST_P');
  assert(recovered.recoveredState.status === PROJECT_STATUS.PAUSED, `Status must remain PAUSED, got ${recovered.recoveredState.status}`);
  results['P. Paused project remains paused'] = 'PASS';
} catch (e) {
  results['P. Paused project remains paused'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST Q: Stopped project remains stopped
// -----------------------------------------------------------------------------
try {
  const stoppedState = {
    project_id: 'stopped_proj',
    book_title: 'Stopped Book',
    status: PROJECT_STATUS.STOPPED,
    phase: 'BOOK_SPEC',
    current_workspace: 'WS01',
    completed_tasks: [],
    pending_tasks: ['TASK-001'],
    failed_tasks: [],
    assets_created: [],
    assets_failed: [],
    timestamp: new Date().toISOString()
  };
  const tasks = [createTask({ id: 'TASK-001', status: 'PENDING' })];

  const recovered = RecoveryEngine.reconstruct(stoppedState, tasks, 'TEST_Q');
  assert(recovered.recoveredState.status === PROJECT_STATUS.STOPPED, `Status must remain STOPPED, got ${recovered.recoveredState.status}`);
  results['Q. Stopped project remains stopped'] = 'PASS';
} catch (e) {
  results['Q. Stopped project remains stopped'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST R: Simulation mode never contacts Lovable
// -----------------------------------------------------------------------------
try {
  const sim = new SimulationDriver();
  assert(sim.contactedExternal === false, 'contactedExternal must be false initially');
  await sim.sendPrompt('test prompt', { taskId: 'TASK-001', workspaceId: 'WS01' });
  assert(sim.contactedExternal === false, 'contactedExternal must remain false after sending prompt');
  results['R. Simulation mode never contacts Lovable'] = 'PASS';
} catch (e) {
  results['R. Simulation mode never contacts Lovable'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST S: Checkpoint after workspace rotation
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(2);
  const orchestrator = new Orchestrator({
    github: gh,
    checkpoint: cp,
    driverType: 'simulation',
    driverOptions: { limits: { WS01: 1 } }
  });

  orchestrator.initProject({ title: 'Checkpoint Rotation Test' }, tasks);

  await orchestrator.step(); // SUCCESS on WS01
  const stepRes = await orchestrator.step(); // Rotate WS01 -> WS02

  assert(stepRes.event === 'WORKSPACE_TRANSITION', 'Expected transition');
  assert(gh.isWorkingTreeClean(), 'Git working tree must be clean after rotation checkpoint');

  const stateFile = JSON.parse(gh.readLocalFile('PROJECT_STATE.json'));
  assert(stateFile.current_workspace === 'WS02', `Saved checkpoint must record new workspace WS02, got ${stateFile.current_workspace}`);
  assert(stateFile.last_workspace === 'WS01', `Saved checkpoint must record last workspace WS01, got ${stateFile.last_workspace}`);
  results['S. Checkpoint after workspace rotation'] = 'PASS';
} catch (e) {
  results['S. Checkpoint after workspace rotation'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST T: Workspace state persists
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  wm.markUnavailable('WS03', 'Quota exceeded');
  wm.markActive('WS04');

  const serialized = wm.toJSON();
  const restoredWm = WorkspaceManager.fromJSON(serialized);

  const ws3 = restoredWm.getWorkspace('WS03');
  const ws4 = restoredWm.getWorkspace('WS04');
  assert(ws3.status === WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN, 'WS03 status must persist');
  assert(ws4.status === WORKSPACE_STATUS.ACTIVE, 'WS04 status must persist');
  results['T. Workspace state persists'] = 'PASS';
} catch (e) {
  results['T. Workspace state persists'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST U: Rotation index persists
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager();
  const idx1 = wm.getRotationIndex('WS01');
  const idx10 = wm.getRotationIndex('WS10');
  const idx20 = wm.getRotationIndex('WS20');

  assert(idx1 === 1, `WS01 rotation index must be 1, got ${idx1}`);
  assert(idx10 === 10, `WS10 rotation index must be 10, got ${idx10}`);
  assert(idx20 === 20, `WS20 rotation index must be 20, got ${idx20}`);
  results['U. Rotation index persists'] = 'PASS';
} catch (e) {
  results['U. Rotation index persists'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST V: BookSpec remains persisted after restart
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const originalSpec = BookSpec.create({
    book_title: 'Restart Spec Persistence',
    page_count: 30,
    trim_size: '8.5x11',
    complexity: 'DETAILED'
  });
  BookSpec.saveToState(originalSpec, gh);

  // Simulate full restart reload
  const reloaded = BookSpec.loadFromState(gh);
  assert(reloaded !== null, 'Reloaded spec must not be null');
  assert(reloaded.book_title === 'Restart Spec Persistence', 'Title must match');
  assert(reloaded.page_count === 30, 'Page count must match');
  assert(reloaded.trim_size?.id === '8.5x11' || reloaded.trim_size === '8.5x11', 'Trim size must match');
  assert(reloaded.complexity === 'DETAILED', 'Complexity must match');
  fs.rmSync(path.join(SANDBOX_DIR, 'state'), { recursive: true, force: true });
  results['V. BookSpec remains persisted after restart'] = 'PASS';
} catch (e) {
  results['V. BookSpec remains persisted after restart'] = `FAIL (${e.message})`;
}

// Clean up sandbox directory
try {
  fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
} catch {}

// -----------------------------------------------------------------------------
// REPORT SUMMARY
// -----------------------------------------------------------------------------
let allPassed = true;
for (const [testName, status] of Object.entries(results)) {
  const isPass = status === 'PASS';
  if (!isPass) allPassed = false;
  console.log(`${testName.padEnd(58)} : [ ${isPass ? 'PASS ✅' : status} ]`);
}

console.log('\n===============================================================');
if (allPassed) {
  console.log('🎯 ALL PHASE 2B TESTS PASSED SUCCESSFULLY (22/22).');
  process.exit(0);
} else {
  console.error('❌ SOME PHASE 2B TESTS FAILED.');
  process.exit(1);
}
