/**
 * lovable/drivers/SimulationDriver.js
 * Zero-credit simulation driver for verified end-to-end rotation testing.
 * Does NOT spend real Lovable credits or contact Lovable servers.
 */

export class SimulationDriver {
  constructor(config = {}) {
    this.name = 'SimulationDriver';
    // Mapping of workspaceId -> max tasks before triggering limit signal
    this.limits = config.limits || {
      WS01: 1, // Limit after 1 task
      WS02: 2, // Limit after 2 tasks
      WS03: 2,
      WS04: 2,
      WS05: 2
    };
    this.tasksCompletedPerWorkspace = {};
    this.log = [];
  }

  async isAvailable() {
    return true;
  }

  /**
   * Evaluates if workspace can continue based on simulation limits.
   * Emulates legitimate limit notice detection.
   */
  async canContinue(workspace) {
    const wsId = typeof workspace === 'string' ? workspace : workspace.id;
    const count = this.tasksCompletedPerWorkspace[wsId] || 0;
    const maxAllowed = this.limits[wsId] ?? 3;

    const allowed = count < maxAllowed;
    this.log.push({
      event: 'canContinue_check',
      workspace: wsId,
      tasksDone: count,
      limit: maxAllowed,
      allowed
    });
    return allowed;
  }

  async selectWorkspace(workspace) {
    const wsId = typeof workspace === 'string' ? workspace : workspace.id;
    this.log.push({ event: 'select_workspace', workspace: wsId });
    return { ok: true, workspace: wsId };
  }

  async sendPrompt(prompt, context = {}) {
    const wsId = context.workspaceId || 'WS01';
    this.tasksCompletedPerWorkspace[wsId] = (this.tasksCompletedPerWorkspace[wsId] || 0) + 1;

    this.log.push({
      event: 'send_prompt',
      taskId: context.taskId,
      workspace: wsId,
      tasksOnWS: this.tasksCompletedPerWorkspace[wsId]
    });

    // Simulate turn completion
    return {
      ok: true,
      taskId: context.taskId,
      workspace: wsId,
      turnEnded: true,
      markerDetected: true,
      output: `[Simulation] Completed ${context.taskId} on ${wsId}\n[[TASK_DONE]]`
    };
  }

  async getProjectStatus() {
    return {
      driver: this.name,
      available: true,
      simulation: true
    };
  }
}
