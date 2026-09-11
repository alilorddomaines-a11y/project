/**
 * workspaces/WorkspaceConfig.js
 * Default configuration for the 15 existing Lovable Workspaces (WS01 - WS15).
 */

export const WORKSPACE_STATUS = {
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
  UNAVAILABLE_FOR_RUN: 'UNAVAILABLE_FOR_RUN',
  DISABLED: 'DISABLED'
};

export function createDefault15Workspaces() {
  const list = [];
  for (let i = 1; i <= 15; i++) {
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
