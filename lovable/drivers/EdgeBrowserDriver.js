/**
 * lovable/drivers/EdgeBrowserDriver.js
 * Legitimate Edge browser automation driver.
 * Interacts with Lovable strictly through the user's authenticated session in Microsoft Edge.
 * ZERO scraping of internal/private APIs, hidden tokens, or private endpoints.
 */

export class EdgeBrowserDriver {
  constructor(config = {}) {
    this.name = 'EdgeBrowserDriver';
    this.tabQuery = { url: 'https://lovable.dev/*' };
    this.timeoutMs = config.timeoutMs || 15 * 60 * 1000; // 15 min max per turn
  }

  async isAvailable() {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      return false; // Running outside of extension context
    }
    const [tab] = await chrome.tabs.query(this.tabQuery);
    return !!tab;
  }

  async getActiveTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    const [tab] = await chrome.tabs.query(this.tabQuery);
    return tab || null;
  }

  /**
   * Abstract capability: canContinue(workspace)
   * Evaluates legitimate signals from visible UI without scraping hidden APIs.
   * If a visible limit banner is detected, returns false.
   */
  async canContinue(workspace) {
    const tab = await this.getActiveTab();
    if (!tab) return false;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_LIMIT_SIGNAL' });
      if (response && response.limitDetected) {
        return false;
      }
      return true;
    } catch {
      // Tab unresponsive or navigating
      return false;
    }
  }

  async selectWorkspace(workspace) {
    const tab = await this.getActiveTab();
    if (!tab) {
      if (chrome.tabs.create) {
        return await chrome.tabs.create({ url: workspace.url });
      }
      throw new Error('No open Lovable tab found in Edge.');
    }

    if (tab.url !== workspace.url) {
      await chrome.tabs.update(tab.id, { url: workspace.url, active: true });
      // Wait for navigation and bridge initialization
      await new Promise(r => setTimeout(r, 4000));
    }
    return tab;
  }

  async sendPrompt(prompt, context = {}) {
    const tab = await this.getActiveTab();
    if (!tab) {
      throw new Error('Lovable tab not found in Edge. Please open https://lovable.dev/');
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'DISPATCH_PROMPT',
      prompt,
      taskId: context.taskId
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || 'Failed to dispatch prompt to Lovable UI');
    }

    return response;
  }

  async getProjectStatus() {
    const tab = await this.getActiveTab();
    return {
      driver: this.name,
      available: !!tab,
      activeUrl: tab ? tab.url : null
    };
  }
}
