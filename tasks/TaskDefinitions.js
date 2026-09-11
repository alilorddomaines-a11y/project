/**
 * tasks/TaskDefinitions.js
 * Standard definitions and factory for KDP factory tasks.
 */

export const TASK_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED'
};

export function createTask({
  id,
  type,
  description,
  priority = 1,
  workspace = null,
  dependencies = [],
  status = TASK_STATUS.PENDING
}) {
  const now = new Date().toISOString();
  return {
    id,
    type,
    description,
    status,
    priority,
    workspace,
    attempts: 0,
    dependencies,
    outputs: {},
    errors: [],
    created_at: now,
    updated_at: now
  };
}

export function createStandardMilestoneTasks(pageCount = 10) {
  return [
    createTask({
      id: 'TASK-001',
      type: 'BOOK_SPEC',
      description: 'Create and validate book specification',
      priority: 1,
      dependencies: []
    }),
    createTask({
      id: 'TASK-002',
      type: 'PAGE_CONCEPTS',
      description: `Generate ${pageCount} unique page concepts`,
      priority: 2,
      dependencies: ['TASK-001']
    }),
    createTask({
      id: 'TASK-003',
      type: 'PROMPT_GEN',
      description: `Generate ${pageCount} high-quality line art prompts`,
      priority: 3,
      dependencies: ['TASK-002']
    }),
    createTask({
      id: 'TASK-004',
      type: 'ILLUSTRATIONS',
      description: `Collect and generate ${pageCount} coloring illustrations`,
      priority: 4,
      dependencies: ['TASK-003']
    }),
    createTask({
      id: 'TASK-005',
      type: 'VALIDATION',
      description: 'Run automated image validation & color detection',
      priority: 5,
      dependencies: ['TASK-004']
    }),
    createTask({
      id: 'TASK-006',
      type: 'DUPLICATE_CHECK',
      description: 'Run perceptual hashing duplicate detection',
      priority: 6,
      dependencies: ['TASK-005']
    }),
    createTask({
      id: 'TASK-007',
      type: 'PPTX_LAYOUT',
      description: 'Build PowerPoint presentation with exact trim size',
      priority: 7,
      dependencies: ['TASK-006']
    }),
    createTask({
      id: 'TASK-008',
      type: 'FRONT_MATTER',
      description: 'Generate title page, copyright and intro slides',
      priority: 8,
      dependencies: ['TASK-007']
    }),
    createTask({
      id: 'TASK-009',
      type: 'KDP_QC',
      description: 'Execute Amazon KDP compliance quality control checks',
      priority: 9,
      dependencies: ['TASK-008']
    }),
    createTask({
      id: 'TASK-010',
      type: 'EXPORT',
      description: 'Export final PPTX and validation reports to output',
      priority: 10,
      dependencies: ['TASK-009']
    })
  ];
}
