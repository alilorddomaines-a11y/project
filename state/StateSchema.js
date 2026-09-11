/**
 * state/StateSchema.js
 * Canonical schema, validation, and factory for PROJECT_STATE.json
 */

export const PROJECT_STATUS = {
  INITIALIZING: 'INITIALIZING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED'
};

export const PROJECT_PHASE = {
  BOOK_SPEC: 'BOOK_SPEC',
  PAGE_CONCEPTS: 'PAGE_CONCEPTS',
  PROMPTS: 'PROMPTS',
  ILLUSTRATIONS: 'ILLUSTRATIONS',
  VALIDATION: 'VALIDATION',
  PPTX: 'PPTX',
  COMPLETE: 'COMPLETE'
};

export function createInitialState(spec = {}, initialTasks = [], initialWorkspaceId = 'WS01') {
  const now = new Date().toISOString();
  return {
    project_id: spec.id || `kdp_proj_${Date.now()}`,
    book_title: spec.book_title || spec.title || 'Untitled Coloring Book',
    book_spec: spec,
    status: PROJECT_STATUS.INITIALIZING,
    phase: PROJECT_PHASE.BOOK_SPEC,
    current_task: initialTasks.length ? initialTasks[0].id : null,
    current_workspace: initialWorkspaceId,
    last_workspace: null,
    rotation_index: 1,
    completed_tasks: [],
    pending_tasks: initialTasks.map(t => t.id),
    failed_tasks: [],
    blocked_tasks: [],
    assets_created: [],
    assets_failed: [],
    last_commit: '',
    last_successful_operation: 'Project initialized',
    timestamp: now
  };
}

export function validateState(state) {
  const requiredKeys = [
    'project_id',
    'book_title',
    'status',
    'phase',
    'current_workspace',
    'completed_tasks',
    'pending_tasks',
    'failed_tasks',
    'assets_created',
    'assets_failed',
    'timestamp'
  ];

  for (const key of requiredKeys) {
    if (state[key] === undefined) {
      throw new Error(`Invalid state: missing required key "${key}"`);
    }
  }

  if (!Array.isArray(state.completed_tasks)) throw new Error('completed_tasks must be an array');
  if (!Array.isArray(state.pending_tasks)) throw new Error('pending_tasks must be an array');
  if (!Array.isArray(state.failed_tasks)) throw new Error('failed_tasks must be an array');

  return true;
}
