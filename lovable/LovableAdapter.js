/**
 * lovable/LovableAdapter.js
 * Unified facade isolating the orchestrator from underlying driver details.
 */

import { MCPDriver } from './drivers/MCPDriver.js';
import { EdgeBrowserDriver } from './drivers/EdgeBrowserDriver.js';
import { SimulationDriver } from './drivers/SimulationDriver.js';

export class LovableAdapter {
  /**
   * @param {'browser' | 'mcp' | 'simulation'} driverType
   * @param {Object} options
   */
  constructor(driverType = 'simulation', options = {}) {
    this.driverType = driverType;
    this.options = options;
    this.initDriver();
  }

  initDriver() {
    const norm = String(this.driverType || '').trim().toLowerCase();
    switch (norm) {
      case 'mcp':
        this.driver = new MCPDriver(this.options);
        break;
      case 'browser':
      case 'edge_browser':
      case 'edgebrowser':
        this.driver = new EdgeBrowserDriver(this.options);
        break;
      case 'simulation':
      default:
        this.driver = new SimulationDriver(this.options);
        break;
    }
  }

  setDriver(driverType, options = {}) {
    this.driverType = driverType;
    this.options = { ...this.options, ...options };
    this.initDriver();
  }

  getDriverName() {
    return this.driver?.name || 'UnknownDriver';
  }

  async isAvailable() {
    return await this.driver.isAvailable();
  }

  async canContinue(workspace) {
    return await this.driver.canContinue(workspace);
  }

  async selectWorkspace(workspace) {
    return await this.driver.selectWorkspace(workspace);
  }

  async sendPrompt(prompt, context = {}) {
    return await this.driver.sendPrompt(prompt, context);
  }

  async checkAuth(tab = null) {
    if (typeof this.driver?.checkAuth === 'function') {
      return await this.driver.checkAuth(tab);
    }
    return { ok: true, authenticated: true };
  }

  async discoverWorkspaces(tab = null) {
    if (typeof this.driver?.discoverWorkspaces === 'function') {
      return await this.driver.discoverWorkspaces(tab);
    }
    return [];
  }

  async resolveProject(projectName = null, tab = null) {
    if (typeof this.driver?.resolveProject === 'function') {
      return await this.driver.resolveProject(projectName, tab);
    }
    return { ok: true, inProject: true };
  }

  async getProjectStatus() {
    return await this.driver.getProjectStatus();
  }
}
