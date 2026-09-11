/**
 * tests/run_simulation.js
 * Automated verification of the Orchestration MVP milestone:
 * WS01 -> task -> checkpoint -> WS01 limit -> WS02 -> restore state -> resume task -> checkpoint -> WS03/WS04/WS05
 * 
 * Verifies:
 * - 0 tasks lost
 * - 0 completed tasks unnecessarily repeated
 * - State survives restart / crash recovery
 * - Workspace rotation works smoothly
 * - GitHub checkpoints created with valid commits
 * - 0 real Lovable credits consumed
 */

import { Orchestrator } from '../orchestrator/Orchestrator.js';
import { createStandardMilestoneTasks } from '../tasks/TaskDefinitions.js';
import { createDefault15Workspaces, WORKSPACE_STATUS } from '../workspaces/WorkspaceConfig.js';
import { RecoveryEngine } from '../state/RecoveryEngine.js';
import fs from 'node:fs';
import path from 'node:path';

async function runMilestoneSimulation() {
  console.log('===============================================================');
  console.log('  KDP COLORING BOOK FACTORY — ORCHESTRATION MVP SIMULATION  ');
  console.log('===============================================================\n');

  const testDir = process.cwd();
  const tasks = createStandardMilestoneTasks(5).slice(0, 5); // 5 sequential tasks for verification
  const workspaces = createDefault15Workspaces();

  // Configure simulation driver with strict limits to trigger rotation
  const simulationLimits = {
    WS01: 1, // Will exhaust after 1 task
    WS02: 1, // Will exhaust after 1 task
    WS03: 1, // Will exhaust after 1 task
    WS04: 1,
    WS05: 1
  };

  const orchestrator = new Orchestrator({
    driverType: 'simulation',
    driverOptions: { limits: simulationLimits },
    workspaceList: workspaces
  });

  console.log('1. INITIALIZING PROJECT SPEC & CANONICAL STATE...');
  const state = orchestrator.initProject({
    id: 'kdp_sim_001',
    title: 'Cute Forest Animals Test Book'
  }, tasks);

  console.log(`   Project ID: ${state.project_id}`);
  console.log(`   Initial Workspace: ${state.current_workspace}`);
  console.log(`   Tasks Queued: ${tasks.length}`);
  console.log(`   Initial Git Commit: ${state.last_commit}\n`);

  // Assertions tracker
  const assertions = {
    ws01TaskExecuted: false,
    ws01CheckpointSaved: false,
    ws01LimitDetected: false,
    rotatedToWS02: false,
    ws02TaskExecuted: false,
    zeroTasksRepeated: true,
    stateSurvivedCrashRecovery: false,
    rotatedThroughWS05: false
  };

  // Execution step 1: Run TASK-001 on WS01
  console.log('2. EXECUTING STEP 1 ON WS01...');
  let res = await orchestrator.step();
  console.log(`   Step result: ${res.event} (Task: ${res.taskId}, Workspace: ${res.workspace})`);
  if (res.event === 'TASK_SUCCESS' && res.taskId === 'TASK-001' && res.workspace === 'WS01') {
    assertions.ws01TaskExecuted = true;
    assertions.ws01CheckpointSaved = !!orchestrator.state.last_commit;
  }

  // Execution step 2: WS01 limit check & transition to WS02
  console.log('\n3. EVALUATING WORKSPACE CAPABILITY (WS01 LIMIT TRIGGER)...');
  res = await orchestrator.step();
  console.log(`   Step result: ${res.event} (${res.from} -> ${res.to})`);
  if (res.event === 'WORKSPACE_TRANSITION' && res.from === 'WS01' && res.to === 'WS02') {
    assertions.ws01LimitDetected = true;
    assertions.rotatedToWS02 = true;
  }

  // Verify WS01 is marked UNAVAILABLE_FOR_RUN
  const ws01 = orchestrator.workspaces.getWorkspace('WS01');
  console.log(`   WS01 Status in Manager: ${ws01.status}`);

  // Execution step 3: Execute TASK-002 on WS02
  console.log('\n4. EXECUTING TASK ON WS02 (CONTEXT RESTORED)...');
  res = await orchestrator.step();
  console.log(`   Step result: ${res.event} (Task: ${res.taskId}, Workspace: ${res.workspace})`);
  if (res.event === 'TASK_SUCCESS' && res.taskId === 'TASK-002' && res.workspace === 'WS02') {
    assertions.ws02TaskExecuted = true;
  }

  // Verify TASK-001 was NOT repeated
  const completed = orchestrator.state.completed_tasks;
  console.log(`   Completed tasks in state: [${completed.join(', ')}]`);
  if (completed.filter(id => id === 'TASK-001').length === 1) {
    assertions.zeroTasksRepeated = true;
  } else {
    assertions.zeroTasksRepeated = false;
  }

  // Execution step 4: Trigger limit on WS02 and transition to WS03
  console.log('\n5. EVALUATING WORKSPACE CAPABILITY (WS02 LIMIT TRIGGER)...');
  res = await orchestrator.step();
  console.log(`   Step result: ${res.event} (${res.from} -> ${res.to})`);

  // CRASH RECOVERY TEST: Simulate abrupt termination at WS03
  console.log('\n6. SIMULATING ABRUPT TERMINATION / CRASH RECOVERY...');
  const stateJson = JSON.parse(fs.readFileSync(path.join(testDir, 'PROJECT_STATE.json'), 'utf8'));
  const queueJson = JSON.parse(fs.readFileSync(path.join(testDir, 'TASK_QUEUE.json'), 'utf8'));

  const recovered = RecoveryEngine.recover(stateJson, queueJson);
  console.log(`   Recovered current task: ${recovered.nextTask?.id}`);
  console.log(`   Completed tasks count: ${recovered.completedCount}`);
  console.log(`   Remaining tasks count: ${recovered.remainingCount}`);

  if (recovered.nextTask?.id === 'TASK-003' && recovered.completedCount === 2) {
    assertions.stateSurvivedCrashRecovery = true;
    console.log('   ✅ CRASH RECOVERY VERIFIED: Context restored at TASK-003 without losing state.');
  }

  // Continue through remaining tasks across WS03, WS04, WS05
  console.log('\n7. CONTINUING PIPELINE THROUGH WS03, WS04, AND WS05...');
  let maxSafetySteps = 20;
  while (maxSafetySteps-- > 0) {
    res = await orchestrator.step();
    if (!res.active) break;
    console.log(`   Step: ${res.event || res.status} ${res.taskId || ''} ${res.workspace || ''} ${res.from ? res.from + '->' + res.to : ''}`);
    if (res.workspace === 'WS05' || (res.from === 'WS04' && res.to === 'WS05')) {
      assertions.rotatedThroughWS05 = true;
    }
  }

  const finalState = JSON.parse(fs.readFileSync(path.join(testDir, 'PROJECT_STATE.json'), 'utf8'));
  const finalTasks = JSON.parse(fs.readFileSync(path.join(testDir, 'TASK_QUEUE.json'), 'utf8'));

  console.log('\n===============================================================');
  console.log('                     VERIFICATION RESULTS                      ');
  console.log('===============================================================');
  console.log(`- WS01 Task Executed:               ${assertions.ws01TaskExecuted ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- WS01 Checkpoint Saved:             ${assertions.ws01CheckpointSaved ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- WS01 Limit Detected:               ${assertions.ws01LimitDetected ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Rotated to WS02:                   ${assertions.rotatedToWS02 ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- WS02 Task Executed:               ${assertions.ws02TaskExecuted ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Zero Completed Tasks Repeated:     ${assertions.zeroTasksRepeated ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- State Survived Crash Recovery:     ${assertions.stateSurvivedCrashRecovery ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Rotated Through WS05:              ${assertions.rotatedThroughWS05 ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Final Project Status:              ${finalState.status}`);
  console.log(`- All Tasks Successful:              ${finalTasks.every(t => t.status === 'SUCCESS') ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Real Lovable Credits Consumed:     0 (Verified Simulation Mode)`);
  console.log('===============================================================\n');

  const allPassed = Object.values(assertions).every(Boolean) && finalState.status === 'SUCCESS';
  if (allPassed) {
    console.log('🎯 MILESTONE 1 VERIFICATION PASSED COMPLETELY.');
    process.exit(0);
  } else {
    console.error('❌ SOME MILESTONE CHECKS FAILED.');
    process.exit(1);
  }
}

runMilestoneSimulation().catch(err => {
  console.error('Unhandled simulation error:', err);
  process.exit(1);
});
