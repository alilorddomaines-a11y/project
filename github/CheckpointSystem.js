/**
 * github/CheckpointSystem.js
 * Atomic checkpoint engine saving PROJECT_STATE.json, TASK_QUEUE.json,
 * CHANGELOG.md, and PROJECT_STATE.md before workspace transitions and on task success.
 */

import { validateState } from '../state/StateSchema.js';

export class CheckpointSystem {
  constructor(gitHubManager) {
    this.github = gitHubManager;
  }

  generateStateMarkdown(state, tasks) {
    const completed = state.completed_tasks || [];
    const pending = state.pending_tasks || [];
    const progressPct = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

    return `# Canonical Project State: ${state.book_title}

- **Project ID**: \`${state.project_id}\`
- **Status**: \`${state.status}\`
- **Phase**: \`${state.phase}\`
- **Active Workspace**: \`${state.current_workspace}\`
- **Current Task**: \`${state.current_task || 'None'}\`
- **Progress**: ${progressPct}% (${completed.length}/${tasks.length} tasks completed)
- **Last Commit**: \`${state.last_commit || 'HEAD'}\`
- **Last Operation**: ${state.last_successful_operation}
- **Timestamp**: ${state.timestamp}

## Completed Tasks
${completed.length > 0 ? completed.map(id => `- **${id}**`).join('\n') : '_None yet._'}

## Pending Tasks
${pending.length > 0 ? pending.slice(0, 10).map(id => `- ${id}`).join('\n') : '_All tasks completed._'}
`.trim();
  }

  saveCheckpoint({ state, taskQueue, reason = 'Regular checkpoint', triggerCommit = true }) {
    state.timestamp = new Date().toISOString();
    state.last_successful_operation = reason;
    validateState(state);

    const tasks = Array.isArray(taskQueue) ? taskQueue : taskQueue.getAllTasks();

    // 1. Write PROJECT_STATE.json
    this.github.writeProjectFile('PROJECT_STATE.json', state);

    // 2. Write TASK_QUEUE.json
    this.github.writeProjectFile('TASK_QUEUE.json', tasks);

    // 3. Write PROJECT_STATE.md
    const md = this.generateStateMarkdown(state, tasks);
    this.github.writeProjectFile('PROJECT_STATE.md', md);

    // 4. Append to CHANGELOG.md
    const changelogEntry = `\n### [${state.timestamp}] ${reason}\n- Workspace: ${state.current_workspace}\n- Task: ${state.current_task || 'N/A'}\n- Status: ${state.status}\n`;
    const existingLog = this.github.readProjectFile('CHANGELOG.md') || '# KDP Coloring Book Factory — Changelog\n';
    this.github.writeProjectFile('CHANGELOG.md', existingLog + changelogEntry);

    // 5. Commit to repository
    let commitResult = { committed: false, hash: state.last_commit };
    if (triggerCommit) {
      commitResult = this.github.commitChanges(`checkpoint: ${reason} [${state.current_workspace}]`);
      if (commitResult.committed) {
        state.last_commit = commitResult.hash;
        // Re-save JSON with verified hash
        this.github.writeProjectFile('PROJECT_STATE.json', state);
      }
    }

    return {
      success: true,
      commitHash: state.last_commit,
      reason,
      state
    };
  }
}
