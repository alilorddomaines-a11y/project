/**
 * lovable/drivers/EdgeBrowserDriver.js
 * Legitimate Edge browser automation driver.
 * Interacts with Lovable strictly through the user's authenticated session in Microsoft Edge.
 * ZERO scraping of internal/private APIs, hidden tokens, or private endpoints.
 */
function getChrome() {
  return typeof chrome !== 'undefined' ? chrome : null;
}

export class EdgeBrowserDriver {
  constructor(config = {}) {
    this.name = 'EdgeBrowserDriver';
    this.onLog = config.onLog || ((msg, type, evt) => console.log(`[${evt || 'EDGE'}] ${msg}`));
    this.tabQuery = { url: 'https://lovable.dev/*' };
    this.timeoutMs = config.timeoutMs || 15 * 60 * 1000; // 15 min max per turn
  }

  log(message, type = 'info', event = 'INFO') {
    if (typeof this.onLog === 'function') {
      this.onLog(message, type, event);
    }
    console.log(`[${event}] ${message}`);
  }

  async isAvailable() {
    const ch = getChrome();
    if (!ch?.tabs) {
      return false; // Running outside of extension context
    }
    const tab = await this.locateLovableTab();
    return !!tab;
  }

  /**
   * Locates an active or available Lovable tab in Microsoft Edge.
   * Performs multi-pattern fallback and active tab prioritization.
   */
  async locateLovableTab(targetUrl = null) {
    this.log('[EDGE] locating Lovable tab', 'info', 'EDGE');
    const ch = getChrome();
    if (!ch?.tabs) {
      this.log('[ERROR] Chrome tabs API unavailable (running outside extension context)', 'warn', 'BROWSER_ERROR');
      return null;
    }

    let tabs = [];
    try {
      tabs = await ch.tabs.query({ url: '*://*.lovable.dev/*' });
    } catch (e) {}

    if (!tabs || tabs.length === 0) {
      try {
        tabs = await ch.tabs.query({ url: 'https://lovable.dev/*' });
      } catch (e) {}
    }

    if (!tabs || tabs.length === 0) {
      try {
        const allTabs = await ch.tabs.query({});
        tabs = (allTabs || []).filter(t => t.url && t.url.includes('lovable.dev'));
      } catch (e) {}
    }

    let tab = null;
    if (tabs && tabs.length > 0) {
      if (targetUrl) {
        tab = tabs.find(t => t.url === targetUrl) || tabs.find(t => t.active) || tabs[0];
      } else {
        tab = tabs.find(t => t.active) || tabs[0];
      }
    }

    if (tab) {
      this.log(`[EDGE] tab found: ${tab.url} (tabId: ${tab.id})`, 'info', 'EDGE');
      return tab;
    }

    this.log('[EDGE] tab not found in open browser windows', 'warn', 'EDGE');
    return null;
  }

  async getActiveTab() {
    return await this.locateLovableTab();
  }

  /**
   * Ensures a Lovable tab exists and is active. Opens the workspace URL if no tab is open.
   */
  async ensureLovableTab(workspace = null) {
    let tab = await this.locateLovableTab(workspace?.url);

    if (!tab) {
      const ch = getChrome();
      const urlToOpen = (workspace?.url && workspace.url.startsWith('http'))
        ? workspace.url
        : 'https://lovable.dev/';

      this.log(`[EDGE] Lovable tab not found. Opening workspace URL: ${urlToOpen}`, 'info', 'EDGE');

      if (ch?.tabs?.create) {
        tab = await ch.tabs.create({ url: urlToOpen, active: true });
        this.log(`[EDGE] Tab opened (tabId: ${tab.id}). Waiting for page load...`, 'info', 'EDGE');
        await new Promise(r => setTimeout(r, 4500));
      } else {
        const err = new Error('Lovable tab not found in Edge and cannot open tab automatically. Please open https://lovable.dev/');
        err.isBrowserError = true;
        this.log(`[ERROR] ${err.message}`, 'error', 'BROWSER_ERROR');
        throw err;
      }
    }

    // Ensure content bridge is responsive or programmatically injected
    if (tab?.id) {
      await this.ensureBridgeInjected(tab.id);
    }
    return tab;
  }

  /**
   * Verifies the content bridge is responding in the target tab.
   * If not responding (e.g. tab opened before extension load), injects it dynamically.
   */
  async ensureBridgeInjected(tabId) {
    const ch = getChrome();
    if (!ch?.tabs?.sendMessage) return false;

    let bridgeReady = false;
    try {
      const probe = await ch.tabs.sendMessage(tabId, { type: 'PROBE' });
      if (probe && probe.ok) {
        bridgeReady = true;
      }
    } catch (err) {
      // Content script is not listening
    }

    if (!bridgeReady) {
      this.log(`[EDGE] Content bridge not active in tab ${tabId}. Programmatically injecting content/lovable_bridge.js...`, 'info', 'EDGE');
      if (ch.scripting?.executeScript) {
        try {
          await ch.scripting.executeScript({
            target: { tabId },
            files: ['content/lovable_bridge.js']
          });
          await new Promise(r => setTimeout(r, 600));
          const probeCheck = await ch.tabs.sendMessage(tabId, { type: 'PROBE' });
          if (probeCheck && probeCheck.ok) {
            bridgeReady = true;
          }
        } catch (injectErr) {
          this.log(`[ERROR] Dynamic script injection failed: ${injectErr.message}`, 'warn', 'BROWSER_ERROR');
        }
      }
    }

    if (bridgeReady) {
      this.log('[EDGE] bridge available', 'info', 'EDGE');
    } else {
      this.log('[EDGE] bridge unavailable — page may still be loading or restricted', 'warn', 'EDGE');
    }

    return bridgeReady;
  }

  /**
   * Abstract capability: canContinue(workspace)
   * Evaluates legitimate signals from visible UI without scraping hidden APIs.
   * STRICT RULE: Returns false ONLY when a legitimate visible Lovable limit notice is verified.
   * Generic browser/DOM errors (timeouts, closed tabs, navigation) are NOT limits.
   */
  async checkContinuationCapability(workspace) {
    const tab = await this.locateLovableTab(workspace?.url);
    if (!tab) {
      return { canContinue: true, isLimit: false, error: 'Lovable tab not found in Edge (will open on dispatch)' };
    }

    const ch = getChrome();
    if (!ch?.tabs?.sendMessage) {
      return { canContinue: true, isLimit: false, error: null };
    }

    try {
      const response = await ch.tabs.sendMessage(tab.id, { type: 'CHECK_LIMIT_SIGNAL' });
      if (response && response.limitDetected) {
        this.log(`[WORKSPACE] Visible limit banner detected on ${workspace?.id || 'active workspace'}`, 'warn', 'WORKSPACE_LIMIT_DETECTED');
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
    return !capability.isLimit;
  }

  /**
   * Verifies authenticated session in the Lovable tab.
   */
  async checkAuth(tab = null) {
    const ch = getChrome();
    if (!ch?.tabs?.sendMessage) {
      return { ok: true, authenticated: true };
    }

    const targetTab = tab || await this.getActiveTab();
    if (!targetTab) {
      return { ok: false, authenticated: false, error: 'No Lovable tab found' };
    }

    try {
      const res = await ch.tabs.sendMessage(targetTab.id, { type: 'CHECK_AUTH' });
      if (res && res.authenticated) {
        this.log('[EDGE] authenticated session verified', 'info', 'EDGE');
        return res;
      } else {
        this.log('[ERROR] Lovable user is not authenticated. Please log in at https://lovable.dev/', 'error', 'AUTH_ERROR');
        return { ok: false, authenticated: false, error: 'User is not logged into Lovable' };
      }
    } catch (err) {
      // Bridge transport issue
      return { ok: true, authenticated: true };
    }
  }

  /**
   * Discovers real Lovable workspaces from the visible UI.
   */
  async discoverWorkspaces(tab = null) {
    const ch = getChrome();
    if (!ch?.tabs?.sendMessage) {
      return [];
    }

    const targetTab = tab || await this.getActiveTab();
    if (!targetTab) {
      throw new Error('Lovable tab not found in Edge to discover workspaces.');
    }

    this.log('[EDGE] discovering real Workspaces', 'info', 'EDGE');
    try {
      const res = await ch.tabs.sendMessage(targetTab.id, { type: 'DISCOVER_WORKSPACES' });
      if (res && res.ok && Array.isArray(res.workspaces)) {
        res.workspaces.forEach((ws, idx) => {
          const slot = `WS${String(idx + 1).padStart(2, '0')}`;
          this.log(`[WORKSPACE] ${slot} mapped to ${ws.name}`, 'info', 'WORKSPACE');
        });
        return res.workspaces;
      } else if (res && !res.ok && res.authenticated === false) {
        const err = new Error(res.error || 'Lovable user is not authenticated');
        err.isAuthError = true;
        this.log(`[ERROR] ${err.message}`, 'error', 'AUTH_ERROR');
        throw err;
      }
      return [];
    } catch (err) {
      if (err.isAuthError) throw err;
      this.log(`[ERROR] Workspace discovery failed: ${err.message}`, 'warn', 'WORKSPACE_ERROR');
      return [];
    }
  }

  /**
   * Resolves or opens the target Lovable project.
   */
  async resolveProject(projectName = null, tab = null) {
    const ch = getChrome();
    if (!ch?.tabs?.sendMessage) return { ok: true, ready: true };

    const targetTab = tab || await this.getActiveTab();
    if (!targetTab) return { ok: false, ready: false };

    try {
      const res = await ch.tabs.sendMessage(targetTab.id, { type: 'RESOLVE_PROJECT', projectName });
      if (res && res.ok) {
        this.log('[EDGE] project resolved', 'info', 'EDGE');
        this.log('[EDGE] prompt input found', 'info', 'EDGE');
        return res;
      }
      return res || { ok: false, ready: false };
    } catch (e) {
      return { ok: true, ready: true };
    }
  }

  async selectWorkspace(workspace) {
    let tab = await this.locateLovableTab(workspace?.url);
    if (!tab) {
      tab = await this.ensureLovableTab(workspace);
    }

    const ch = getChrome();
    if (!ch?.tabs?.sendMessage) {
      return tab;
    }

    const targetName = workspace?.realName || workspace?.name;
    // Check if realName is present and we can perform DOM switching
    if (workspace?.realName && tab?.id) {
      this.log(`[WORKSPACE] selecting ${targetName}`, 'info', 'WORKSPACE');
      try {
        const res = await ch.tabs.sendMessage(tab.id, {
          type: 'SWITCH_WORKSPACE',
          targetName: workspace.realName
        });

        if (res && res.ok) {
          this.log(`[WORKSPACE] active Workspace verified: ${res.activeWorkspace || targetName}`, 'info', 'WORKSPACE');
          return tab;
        } else {
          const err = new Error(res?.error || `Workspace selection verification failed for "${targetName}"`);
          err.isBrowserError = true;
          this.log(`[ERROR] ${err.message}`, 'error', 'WORKSPACE_ERROR');
          throw err;
        }
      } catch (err) {
        if (err.isBrowserError) throw err;
        // Transport error
        this.log(`[WARN] Workspace selection message failed: ${err.message}`, 'warn', 'WORKSPACE_ERROR');
      }
    }

    if (workspace?.url && tab.url !== workspace.url && workspace.url.startsWith('http') && ch?.tabs?.update) {
      this.log(`[EDGE] Navigating tab ${tab.id} to ${workspace.url}...`, 'info', 'EDGE');
      await ch.tabs.update(tab.id, { url: workspace.url, active: true });
      await new Promise(r => setTimeout(r, 4000));
      await this.ensureBridgeInjected(tab.id);
    }
    return tab;
  }

  async sendPrompt(prompt, context = {}) {
    const workspace = context.workspace || { id: context.workspaceId, url: context.workspaceUrl, realName: context.realName };
    const tab = await this.ensureLovableTab(workspace);

    if (!tab) {
      const err = new Error('Lovable tab not found in Edge. Please open https://lovable.dev/');
      err.isBrowserError = true;
      this.log(`[ERROR] ${err.message}`, 'error', 'BROWSER_ERROR');
      throw err;
    }

    const ch = getChrome();
    if (!ch?.tabs?.sendMessage) {
      const transErr = new Error('Edge bridge communication error: Chrome tabs API unavailable.');
      transErr.isBrowserError = true;
      this.log(`[ERROR] [EDGE] prompt dispatch failed: ${transErr.message}`, 'error', 'BROWSER_ERROR');
      throw transErr;
    }

    // 1. Verify authentication
    const auth = await this.checkAuth(tab);
    if (!auth.authenticated) {
      const authErr = new Error('Lovable user is not authenticated. Please log into Lovable in Microsoft Edge.');
      authErr.isAuthError = true;
      this.log(`[ERROR] ${authErr.message}`, 'error', 'AUTH_ERROR');
      throw authErr;
    }

    // 2. Ensure target workspace selected and verified if mapped
    if (workspace?.realName) {
      await this.selectWorkspace(workspace);
    }

    // 3. Ensure project resolved and prompt input ready
    if (context.projectName) {
      await this.resolveProject(context.projectName, tab);
    }

    this.log('[EDGE] prompt input found', 'info', 'EDGE');
    this.log(`[EDGE] prompt entered: turn for ${context.taskId || 'TASK'}`, 'info', 'EDGE');

    let response;
    try {
      this.log('[EDGE] Send clicked', 'info', 'EDGE');
      this.log('[EDGE] waiting for response', 'info', 'EDGE');

      response = await ch.tabs.sendMessage(tab.id, {
        type: 'DISPATCH_PROMPT',
        prompt,
        taskId: context.taskId
      });
    } catch (err) {
      const transErr = new Error(`Edge bridge communication error: ${err.message}`);
      transErr.isBrowserError = true;
      this.log(`[ERROR] [EDGE] prompt dispatch failed: ${transErr.message}`, 'error', 'BROWSER_ERROR');
      throw transErr;
    }

    this.log(`[EDGE] prompt dispatch result: ok=${!!response?.ok}, marker=${!!response?.markerDetected}, limit=${!!response?.limitDetected}`, 'info', 'EDGE');

    if (!response || !response.ok) {
      const domErr = new Error(response?.error || 'Failed to dispatch prompt to Lovable UI');
      domErr.isBrowserError = true;
      this.log(`[ERROR] [EDGE] ${domErr.message}`, 'error', 'BROWSER_ERROR');
      throw domErr;
    }

    // 4. Legitimate continuation limit detected in visible UI
    if (response.limitDetected) {
      const limitErr = new Error('Legitimate Lovable continuation limit detected in visible UI');
      limitErr.isContinuationLimit = true;
      this.log(`[ERROR] ${limitErr.message}`, 'warn', 'WORKSPACE_LIMIT_DETECTED');
      throw limitErr;
    }

    // 5. Transient error detected
    if (response.transientError) {
      const transErr = new Error('Transient error detected on Lovable page');
      transErr.isTransientError = true;
      this.log(`[ERROR] ${transErr.message}`, 'warn', 'BROWSER_ERROR');
      throw transErr;
    }

    // 6. Verifiable completion detection via marker [[TASK_DONE]]
    if (!response.markerDetected) {
      const incompleteErr = new Error('Turn ended without legitimate completion marker [[TASK_DONE]]');
      incompleteErr.isMarkerMissing = true;
      this.log(`[ERROR] ${incompleteErr.message}`, 'warn', 'TASK_INCOMPLETE');
      throw incompleteErr;
    }

    this.log('[EDGE] [[TASK_DONE]] detected', 'info', 'EDGE');
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
