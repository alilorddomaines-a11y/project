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
    switch (this.driverType) {
      case 'mcp':
        this.driver = new MCPDriver(this.options);
        break;
      case 'browser':
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

  async getProjectStatus() {
    return await this.driver.getProjectStatus();
  }
}
