/**
 * workspaces/WorkspaceConfig.js
 * Configuration and validation for the user's exactly 20 existing Lovable Workspaces (WS01 - WS20).
 * Hard constraint: NEVER create WS21 or any new workspace.
 */

export const MAX_WORKSPACES = 20;

export const VALID_WORKSPACE_IDS = Object.freeze(
  Array.from({ length: MAX_WORKSPACES }, (_, i) => `WS${String(i + 1).padStart(2, '0')}`)
);

export const WORKSPACE_STATUS = {
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
  UNAVAILABLE_FOR_RUN: 'UNAVAILABLE_FOR_RUN',
  DISABLED: 'DISABLED'
};

export function isValidWorkspaceId(id) {
  return typeof id === 'string' && VALID_WORKSPACE_IDS.includes(id);
}

export function createDefault20Workspaces() {
  const list = [];
  for (let i = 1; i <= MAX_WORKSPACES; i++) {
    const id = `WS${String(i).padStart(2, '0')}`;
    list.push({
      id,
      name: `Workspace ${String(i).padStart(2, '0')}`,
      url: `https://lovable.dev/projects?workspace=${id}`,
      enabled: true,
      order: i,
      status: WORKSPACE_STATUS.IDLE,
      lastUsed: null,
      failureCount: 0
    });
  }
  return list;
}

/**
 * Backward compatibility wrapper for legacy tests and references.
 */
export function createDefault15Workspaces() {
  return createDefault20Workspaces().slice(0, 15);
}

