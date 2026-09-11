/**
 * workspaces/WorkspaceManager.js
 * Manages the user's exactly 20 existing Lovable workspaces (WS01 - WS20),
 * circular rotation state machine (WS01 -> ... -> WS20 -> WS01),
 * availability tracking, and handoffs.
 * 
 * Hard constraint: NEVER create WS21 or any new workspace.
 */

import {
  WORKSPACE_STATUS,
  createDefault20Workspaces,
  isValidWorkspaceId,
  MAX_WORKSPACES,
  VALID_WORKSPACE_IDS
} from './WorkspaceConfig.js';

export class WorkspaceManager {
  constructor(workspaces = null) {
    const rawList = workspaces || createDefault20Workspaces();
    this.validateWorkspaceList(rawList);
    this.workspaces = rawList;
    this.ensureOrdering();
  }

  validateWorkspaceList(list) {
    if (!Array.isArray(list)) {
      throw new Error('Workspace list must be an array.');
    }
    if (list.length > MAX_WORKSPACES) {
      throw new Error(`Exceeded maximum allowed workspaces (${MAX_WORKSPACES}). NEVER create WS21 or any new workspace.`);
    }
    for (const ws of list) {
      if (!isValidWorkspaceId(ws.id)) {
        throw new Error(`Invalid workspace ID: "${ws.id}". Only ${VALID_WORKSPACE_IDS.join(', ')} are permitted.`);
      }
    }
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

  getRotationIndex(id) {
    const idx = this.workspaces.findIndex(w => w.id === id);
    return idx >= 0 ? idx + 1 : null;
  }

  getActiveWorkspace() {
    return this.workspaces.find(w => w.status === WORKSPACE_STATUS.ACTIVE) || null;
  }

  getUnavailableWorkspaces() {
    return this.workspaces.filter(w => w.status === WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN);
  }

  isExhausted() {
    const enabled = this.workspaces.filter(w => w.enabled && w.status !== WORKSPACE_STATUS.DISABLED);
    if (enabled.length === 0) return true;
    return enabled.every(w => w.status === WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN);
  }

  updateWorkspace(id, updates = {}) {
    if (updates.id && !isValidWorkspaceId(updates.id)) {
      throw new Error(`Cannot update to invalid workspace ID "${updates.id}". Only WS01-WS20 are permitted.`);
    }
    const ws = this.getWorkspace(id);
    if (!ws) throw new Error(`Workspace ${id} not found.`);
    Object.assign(ws, updates);
    this.ensureOrdering();
    return ws;
  }

  /**
   * Returns the next available, enabled workspace in circular order.
   * WS01 -> WS02 -> ... -> WS19 -> WS20 -> WS01
   * @param {string|null} currentId
   * @returns {Object|null}
   */
  getNextWorkspace(currentId = null) {
    this.ensureOrdering();
    const enabledWorkspaces = this.workspaces.filter(
      w => w.enabled && w.status !== WORKSPACE_STATUS.UNAVAILABLE_FOR_RUN && w.status !== WORKSPACE_STATUS.DISABLED
    );

    if (enabledWorkspaces.length === 0) {
      return null; // All workspaces unavailable (Exhaustion)
    }

    if (!currentId) {
      return enabledWorkspaces[0];
    }

    const currentIndex = this.workspaces.findIndex(w => w.id === currentId);
    if (currentIndex === -1) {
      return enabledWorkspaces[0];
    }

    const total = this.workspaces.length;

    // Search cyclically forward from currentIndex + 1 through total
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

