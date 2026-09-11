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
   * STRICT RULE: Returns false ONLY when a legitimate visible Lovable limit notice is verified.
   * Generic browser/DOM errors (timeouts, closed tabs, navigation) are NOT limits.
   */
  async checkContinuationCapability(workspace) {
    const tab = await this.getActiveTab();
    if (!tab) {
      return { canContinue: true, isLimit: false, error: 'Lovable tab not found in Edge' };
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_LIMIT_SIGNAL' });
      if (response && response.limitDetected) {
        return { canContinue: false, isLimit: true, reason: 'Visible credit/plan limit notice detected' };
      }
      return { canContinue: true, isLimit: false, error: null };
    } catch (err) {
      // Browser transport, page loading, or bridge initialization issue — NOT a plan limit
      return { canContinue: true, isLimit: false, error: `Transport error: ${err.message}` };
    }
  }

  async canContinue(workspace) {
    const capability = await this.checkContinuationCapability(workspace);
    // ONLY return false if a legitimate limit was verified
    return !capability.isLimit;
  }

  async selectWorkspace(workspace) {
    const tab = await this.getActiveTab();
    if (!tab) {
      if (chrome.tabs.create) {
        return await chrome.tabs.create({ url: workspace.url });
      }
      const err = new Error('No open Lovable tab found in Edge.');
      err.isBrowserError = true;
      throw err;
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
      const err = new Error('Lovable tab not found in Edge. Please open https://lovable.dev/');
      err.isBrowserError = true;
      throw err;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        type: 'DISPATCH_PROMPT',
        prompt,
        taskId: context.taskId
      });
    } catch (err) {
      const transErr = new Error(`Edge bridge communication error: ${err.message}`);
      transErr.isBrowserError = true;
      throw transErr;
    }

    if (!response || !response.ok) {
      const domErr = new Error(response?.error || 'Failed to dispatch prompt to Lovable UI');
      domErr.isBrowserError = true;
      throw domErr;
    }

    // 1. Legitimate continuation limit detected in visible UI
    if (response.limitDetected) {
      const limitErr = new Error('Legitimate Lovable continuation limit detected in visible UI');
      limitErr.isContinuationLimit = true;
      throw limitErr;
    }

    // 2. Transient error detected
    if (response.transientError) {
      const transErr = new Error('Transient error detected on Lovable page');
      transErr.isTransientError = true;
      throw transErr;
    }

    // 3. Verifiable completion detection via marker [[TASK_DONE]]
    if (!response.markerDetected) {
      const incompleteErr = new Error('Turn ended without legitimate completion marker [[TASK_DONE]]');
      incompleteErr.isMarkerMissing = true;
      throw incompleteErr;
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
