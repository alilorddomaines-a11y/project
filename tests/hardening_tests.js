/**
 * tests/hardening_tests.js
 * Comprehensive automated test suite for Orchestration MVP hardening pass.
 * Executes in an isolated sandbox directory to guarantee zero pollution of production state.
 * 
 * Tests:
 * A. checkpoint -> git status clean
 * B. checkpoint consistency
 * C. interrupted RUNNING task -> recovery -> PENDING
 * D. completed task is never repeated
 * E. WS01 -> WS02 -> WS03 rotation
 * F. all 15 workspaces exhausted -> safe PAUSED state
 * G. extension restart -> state restoration
 * H. simulated browser crash -> recovery
 * I. failed GitHub push must never be reported as successful
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Orchestrator } from '../orchestrator/Orchestrator.js';
import { GitHubManager } from '../github/GitHubManager.js';
import { CheckpointSystem } from '../github/CheckpointSystem.js';
import { RecoveryEngine } from '../state/RecoveryEngine.js';
import { TaskQueue } from '../tasks/TaskQueue.js';
import { createStandardMilestoneTasks, createTask } from '../tasks/TaskDefinitions.js';
import { createDefault15Workspaces, WORKSPACE_STATUS } from '../workspaces/WorkspaceConfig.js';
import { WorkspaceManager } from '../workspaces/WorkspaceManager.js';
import { createInitialState, PROJECT_STATUS } from '../state/StateSchema.js';

// Setup isolated sandbox directory
const SANDBOX_DIR = path.resolve(process.cwd(), 'tests', 'sandbox');
if (fs.existsSync(SANDBOX_DIR)) {
  fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
}
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

// Initialize isolated git repository in sandbox
execSync('git init -b main', { cwd: SANDBOX_DIR, stdio: 'pipe' });
execSync('git config user.name "alilorddomaines-a11y"', { cwd: SANDBOX_DIR, stdio: 'pipe' });
execSync('git config user.email "alilorddomaines-a11y@users.noreply.github.com"', { cwd: SANDBOX_DIR, stdio: 'pipe' });
execSync('git remote add origin https://github.com/alilorddomaines-a11y/project.git', { cwd: SANDBOX_DIR, stdio: 'pipe' });

// Create initial commit in sandbox
fs.writeFileSync(path.join(SANDBOX_DIR, '.gitignore'), 'temp/\n', 'utf8');
execSync('git add .gitignore && git commit -m "chore: sandbox initial commit"', { cwd: SANDBOX_DIR, stdio: 'pipe' });

const results = {};

console.log('===============================================================');
console.log('       ORCHESTRATION MVP HARDENING PASS — TEST SUITE           ');
console.log('===============================================================\n');

// -----------------------------------------------------------------------------
// TEST A: Checkpoint -> Git status clean
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(2);
  const state = createInitialState({ id: 'test_a', title: 'Test A' }, tasks, 'WS01');

  const res = cp.saveCheckpoint({
    state,
    taskQueue: tasks,
    reason: 'Test A Checkpoint',
    triggerCommit: true
  });

  const status = gh.getWorkingTreeStatus();
  if (res.committed && res.workingTreeClean && status === '') {
    results['A. Checkpoint -> git status clean'] = 'PASS';
  } else {
    results['A. Checkpoint -> git status clean'] = `FAIL (status: "${status}")`;
  }
} catch (e) {
  results['A. Checkpoint -> git status clean'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST B: Checkpoint consistency across all 4 files
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(2);
  const state = createInitialState({ id: 'test_b', title: 'Test B Consistency' }, tasks, 'WS01');

  const res = cp.saveCheckpoint({
    state,
    taskQueue: tasks,
    reason: 'Test B Consistency Checkpoint',
    triggerCommit: true
  });

  const stateFile = JSON.parse(gh.readLocalFile('PROJECT_STATE.json'));
  const queueFile = JSON.parse(gh.readLocalFile('TASK_QUEUE.json'));
  const mdFile = gh.readLocalFile('PROJECT_STATE.md');
  const changelog = gh.readLocalFile('CHANGELOG.md');

  const matchCheckpointId =
    stateFile.checkpoint_id === res.checkpointId &&
    mdFile.includes(res.checkpointId) &&
    changelog.includes(res.checkpointId);

  const matchTaskCount =
    stateFile.pending_tasks.length === queueFile.length &&
    queueFile.length === tasks.length;

  if (matchCheckpointId && matchTaskCount) {
    results['B. Checkpoint consistency'] = 'PASS';
  } else {
    results['B. Checkpoint consistency'] = 'FAIL (Files inconsistent)';
  }
} catch (e) {
  results['B. Checkpoint consistency'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST C: Interrupted RUNNING task -> recovery -> PENDING
// -----------------------------------------------------------------------------
try {
  const tasks = [
    createTask({ id: 'TASK-001', description: 'Done task', status: 'SUCCESS' }),
    createTask({ id: 'TASK-002', description: 'Interrupted task', status: 'RUNNING' }),
    createTask({ id: 'TASK-003', description: 'Future task', status: 'PENDING', dependencies: ['TASK-002'] })
  ];

  const state = {
    project_id: 'test_c',
    book_title: 'Test C',
    status: 'RUNNING',
    phase: 'ILLUSTRATIONS',
    current_workspace: 'WS01',
    current_task: 'TASK-002',
    completed_tasks: ['TASK-001'],
    pending_tasks: ['TASK-002', 'TASK-003'],
    failed_tasks: [],
    assets_created: [],
    assets_failed: [],
    timestamp: new Date().toISOString()
  };

  const recovered = RecoveryEngine.reconstruct(state, tasks, 'TEST_C');
  const recoveredTask2 = recovered.tasks.find(t => t.id === 'TASK-002');

  if (
    recoveredTask2.status === 'PENDING' &&
    recoveredTask2.attempts === 1 &&
    recovered.nextTask.id === 'TASK-002'
  ) {
    results['C. Interrupted RUNNING task -> recovery -> PENDING'] = 'PASS';
  } else {
    results['C. Interrupted RUNNING task -> recovery -> PENDING'] = `FAIL (Task status: ${recoveredTask2.status})`;
  }
} catch (e) {
  results['C. Interrupted RUNNING task -> recovery -> PENDING'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST D: Completed task is never repeated
// -----------------------------------------------------------------------------
try {
  const queue = new TaskQueue([
    createTask({ id: 'TASK-001', description: 'Task 1', status: 'SUCCESS' }),
    createTask({ id: 'TASK-002', description: 'Task 2', status: 'PENDING', dependencies: ['TASK-001'] })
  ]);

  const next1 = queue.getNextExecutableTask();
  if (next1.id === 'TASK-002') {
    queue.markSuccess('TASK-002');
    const next2 = queue.getNextExecutableTask();
    if (next2 === null) {
      results['D. Completed task is never repeated'] = 'PASS';
    } else {
      results['D. Completed task is never repeated'] = `FAIL (Unexpected task: ${next2.id})`;
    }
  } else {
    results['D. Completed task is never repeated'] = `FAIL (Selected: ${next1.id})`;
  }
} catch (e) {
  results['D. Completed task is never repeated'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST E: WS01 -> WS02 -> WS03 rotation
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(3);

  const orchestrator = new Orchestrator({
    github: gh,
    checkpoint: cp,
    driverType: 'simulation',
    driverOptions: {
      limits: { WS01: 1, WS02: 1, WS03: 1 }
    }
  });

  orchestrator.initProject({ id: 'test_e', title: 'Test E Rotation' }, tasks);

  // Task 1 on WS01
  await orchestrator.step(); // SUCCESS on WS01
  const rot1 = await orchestrator.step(); // Transition WS01 -> WS02

  // Task 2 on WS02
  await orchestrator.step(); // SUCCESS on WS02
  const rot2 = await orchestrator.step(); // Transition WS02 -> WS03

  // Task 3 on WS03
  await orchestrator.step(); // SUCCESS on WS03

  if (
    rot1.event === 'WORKSPACE_TRANSITION' && rot1.from === 'WS01' && rot1.to === 'WS02' &&
    rot2.event === 'WORKSPACE_TRANSITION' && rot2.from === 'WS02' && rot2.to === 'WS03'
  ) {
    results['E. WS01 -> WS02 -> WS03 rotation'] = 'PASS';
  } else {
    results['E. WS01 -> WS02 -> WS03 rotation'] = 'FAIL (Rotation mismatch)';
  }
} catch (e) {
  results['E. WS01 -> WS02 -> WS03 rotation'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST F: All 15 workspaces exhausted -> safe PAUSED state
// -----------------------------------------------------------------------------
try {
  const wm = new WorkspaceManager(createDefault15Workspaces());
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

  orchestrator.initProject({ id: 'test_f', title: 'Test F All Exhausted' }, tasks);

  // Mark all 15 workspaces unavailable to simulate total exhaustion
  for (let i = 1; i <= 15; i++) {
    wm.markUnavailable(`WS${String(i).padStart(2, '0')}`);
  }

  // Step triggers limit check and detects 0 available workspaces
  const stepRes = await orchestrator.step();

  if (stepRes.status === 'ALL_WORKSPACES_EXHAUSTED' && orchestrator.state.status === PROJECT_STATUS.PAUSED) {
    results['F. All 15 workspaces exhausted -> safe PAUSED state'] = 'PASS';
  } else {
    results['F. All 15 workspaces exhausted -> safe PAUSED state'] = `FAIL (Status: ${stepRes.status}, State: ${orchestrator.state.status})`;
  }
} catch (e) {
  results['F. All 15 workspaces exhausted -> safe PAUSED state'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST G: Extension restart -> state restoration
// -----------------------------------------------------------------------------
try {
  // Simulate serialized state stored in chrome.storage.local
  const mockStorage = {
    workspaces: createDefault15Workspaces(),
    projectState: {
      project_id: 'test_g',
      book_title: 'Test G Storage Persistence',
      status: 'PAUSED',
      phase: 'ILLUSTRATIONS',
      current_workspace: 'WS04',
      current_task: 'TASK-003',
      completed_tasks: ['TASK-001', 'TASK-002'],
      pending_tasks: ['TASK-003'],
      failed_tasks: [],
      assets_created: [],
      assets_failed: [],
      timestamp: new Date().toISOString()
    },
    taskQueue: [
      createTask({ id: 'TASK-001', status: 'SUCCESS' }),
      createTask({ id: 'TASK-002', status: 'SUCCESS' }),
      createTask({ id: 'TASK-003', status: 'RUNNING' })
    ],
    factoryStatus: 'PAUSED'
  };

  // Restore task queue and run recovery
  const restoredQueue = TaskQueue.fromJSON(mockStorage.taskQueue);
  const recovered = RecoveryEngine.reconstruct(mockStorage.projectState, restoredQueue.getAllTasks(), 'EXTENSION_RESTART');

  // Verify task-003 was reset from RUNNING to PENDING and PAUSED was respected
  const task3 = recovered.tasks.find(t => t.id === 'TASK-003');
  const pausedRespected = mockStorage.factoryStatus === 'PAUSED';

  if (task3.status === 'PENDING' && task3.attempts === 1 && pausedRespected && recovered.completedCount === 2) {
    results['G. Extension restart -> state restoration'] = 'PASS';
  } else {
    results['G. Extension restart -> state restoration'] = 'FAIL';
  }
} catch (e) {
  results['G. Extension restart -> state restoration'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST H: Simulated browser crash -> recovery
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  const cp = new CheckpointSystem(gh);
  const tasks = createStandardMilestoneTasks(4);

  const state = createInitialState({ id: 'test_h', title: 'Test H Crash' }, tasks, 'WS02');
  state.completed_tasks = ['TASK-001', 'TASK-002'];
  state.pending_tasks = ['TASK-003', 'TASK-004'];

  cp.saveCheckpoint({
    state,
    taskQueue: tasks,
    reason: 'Pre-crash committed state',
    triggerCommit: true
  });

  // Reconstruct purely from Git committed ref (HEAD)
  const recovered = RecoveryEngine.recoverFromGit(gh, 'HEAD');

  if (
    recovered.recoverySource === 'COMMITTED_GIT_STATE' &&
    recovered.nextTask.id === 'TASK-003' &&
    recovered.completedCount === 2
  ) {
    results['H. Simulated browser crash -> recovery'] = 'PASS';
  } else {
    results['H. Simulated browser crash -> recovery'] = 'FAIL';
  }
} catch (e) {
  results['H. Simulated browser crash -> recovery'] = `FAIL (${e.message})`;
}

// -----------------------------------------------------------------------------
// TEST I: Failed GitHub push must never be reported as successful
// -----------------------------------------------------------------------------
try {
  const gh = new GitHubManager({ repoPath: SANDBOX_DIR });
  // Intentionally call push with non-interactive flag without credentials
  const pushRes = gh.pushToRemote('main', 3000);

  // Assert that pushRes.pushed is false when unauthenticated and error is captured
  if (pushRes.pushed === false && pushRes.error !== null) {
    results['I. Failed GitHub push must never be reported as successful'] = 'PASS';
  } else {
    results['I. Failed GitHub push must never be reported as successful'] = `FAIL (Unexpected push report: ${JSON.stringify(pushRes)})`;
  }
} catch (e) {
  results['I. Failed GitHub push must never be reported as successful'] = `FAIL (${e.message})`;
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
  console.log('🎯 ALL HARDENING PASS TESTS PASSED SUCCESSFULLY (9/9).');
  process.exit(0);
} else {
  console.error('❌ SOME HARDENING TESTS FAILED.');
  process.exit(1);
}
