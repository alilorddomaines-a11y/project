/**
 * lovable/PromptBuilder.js
 * Builds self-contained continuation prompts for Lovable workspaces.
 */

export class PromptBuilder {
  /**
   * Constructs a self-contained continuation prompt based on canonical state.
   * @param {Object} params
   * @returns {string}
   */
  static buildContinuationPrompt({
    projectTitle,
    phase,
    task,
    completedTasks = [],
    pendingTasks = [],
    latestCommit = 'HEAD',
    repository = 'alilorddomaines-a11y/project',
    importantFiles = ['PROJECT_STATE.json', 'TASK_QUEUE.json'],
    constraints = []
  }) {
    const completedList = completedTasks.length ? completedTasks.join(', ') : 'None (initial task)';
    const pendingList = pendingTasks.slice(0, 5).join(', ') + (pendingTasks.length > 5 ? ` (+${pendingTasks.length - 5} more)` : '');

    return `
Continue the existing KDP Coloring Book Factory project.

==================================================
CANONICAL PROJECT STATE
==================================================
Project Title: ${projectTitle}
Canonical Repository: ${repository}
Latest Git Commit: ${latestCommit}
Current Phase: ${phase}
Current Task: ${task.id} - ${task.description}

Completed Tasks:
${completedList}

Upcoming Tasks:
${pendingList}

Important State Files in Repository:
${importantFiles.map(f => `- ${f}`).join('\n')}

==================================================
TASK EXECUTION INSTRUCTIONS
==================================================
1. Do not rebuild completed functionality.
2. Inspect the existing repository state first.
3. Implement only the current task: [${task.id}: ${task.description}].
4. Do not modify unrelated files.
5. Adhere to KDP coloring book quality standards (clean black & white line art, child-friendly, no color, no text, printable margins).
${constraints.map(c => `6. ${c}`).join('\n')}

==================================================
REQUIRED OUTPUT
==================================================
Upon completion of this task, report:
1. Files changed or generated
2. Functionality completed
3. Errors or warnings (if any)
4. Confirm completion by printing this exact marker on its own line:
[[TASK_DONE]]
`.trim();
  }
}
