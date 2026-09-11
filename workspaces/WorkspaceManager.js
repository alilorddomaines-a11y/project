/**
 * workspaces/WorkspaceManager.js
 * Manages the user's 15 existing Lovable workspaces (WS01 - WS15),
 * rotation state machine, availability tracking, and handoffs.
 */

import { WORKSPACE_STATUS, createDefault15Workspaces } from './WorkspaceConfig.js';

export class WorkspaceManager {
  constructor(workspaces = null) {
    this.workspaces = workspaces || createDefault15Workspaces();
    this.ensureOrdering();
  }

  ensureOrdering() {
    this.workspaces.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  getAllWorkspaces() {
    return [...this.workspaces];
  }

  getWorkspace(id) {
    return this.workspaces.find(w => w.id === id) || null;
  }

  updateWorkspace(id, updates = {}) {
    const ws = this.getWorkspace(id);
    if (!ws) throw new Error(`Workspace ${id} not found.`);
    Object.assign(ws, updates);
    this.ensureOrdering();
    return ws;
  }

  /**
   * Returns the next available, enabled workspace in circular order.
   * WS01 -> WS02 -> ... -> WS15 -> WS01
   * @param {string|null} currentId
   * @returns {Object|null}
   */
  getNextWorkspace(currentId = null) {
    this.ensureOrdering();
    const enabledWorkspaces = this.workspaces.filter(
      w => w.enabled && w.status !== WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN && w.status !== WORKSPACE_STATUS.DISABLED
    );

    if (enabledWorkspaces.length === 0) {
      return null; // All workspaces unavailable
    }

    if (!currentId) {
      return enabledWorkspaces[0];
    }

    const currentIndex = this.workspaces.findIndex(w => w.id === currentId);
    const total = this.workspaces.length;

    // Search cyclically forward from currentIndex + 1
    for (let offset = 1; offset <= total; offset++) {
      const candidate = this.workspaces[(currentIndex + offset) % total];
      if (candidate.enabled && candidate.status !== WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN && candidate.status !== WORKSPACE_STATUS.DISABLED) {
        return candidate;
      }
    }

    return null;
  }

  markActive(id) {
    const ws = this.getWorkspace(id);
    if (ws) {
      ws.status = WORKSPACE_STATUS.ACTIVE;
      ws.lastUsed = new Date().toISOString();
    }
  }

  markUnavailable(id, reason = 'Legitimate limit reached') {
    const ws = this.getWorkspace(id);
    if (ws) {
      ws.status = WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN;
      ws.failureCount = (ws.failureCount || 0) + 1;
      ws.unavailableReason = reason;
      ws.unavailableAt = new Date().toISOString();
    }
  }

  resetRunStatuses() {
    for (const ws of this.workspaces) {
      if (ws.status === WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN || ws.status === WORKSPACE_STATUS.ACTIVE) {
        ws.status = WORKSPACE_STATUS.IDLE;
      }
    }
  }

  toJSON() {
    return JSON.parse(JSON.stringify(this.workspaces));
  }

  static fromJSON(jsonArray) {
    return new WorkspaceManager(Array.isArray(jsonArray) ? jsonArray : null);
  }
}
