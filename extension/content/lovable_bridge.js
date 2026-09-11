/**
 * extension/content/lovable_bridge.js
 * Hardened DOM bridge strictly limited to visible, legitimate UI interactions.
 * ZERO private APIs, internal endpoints, token extraction, or network interception.
 */

(() => {
  const IDLE_POLLS = 5;
  const POLL_MS = 900;
  const HARD_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max per turn

  // Visible UI patterns for plan limits & transient errors
  const CREDIT_LIMIT_RE = /((out of|run out of|no) credits?|credit limit|monthly limit reached|you(?:'|’)ve reached your (daily|monthly|plan)? limit|upgrade (your )?plan to continue|credits? (depleted|exhausted)|plan limit)/i;
  const TRANSIENT_ERROR_RE = /(something went wrong|rate limit|too many requests|generation failed|please try again|server error|network disconnected)/i;

  let watching = false;

  function findChatInput() {
    const candidates = [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="what" i]',
      'textarea[placeholder*="build" i]',
      'textarea[placeholder*="type" i]',
      'textarea[data-testid*="chat" i]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      'form textarea',
      'main textarea',
      'textarea'
    ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el && !el.disabled && el.offsetParent !== null) {
        return el;
      }
    }
    return null;
  }

  function findSendButton() {
    const input = findChatInput();
    const container = input ? input.closest('form, div:has(textarea), div:has([role="textbox"])') : document;

    const candidates = [
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[title*="send" i]',
      'button[data-testid*="send" i]',
      'button:has(svg[data-icon="send"])',
      'button:has(svg)'
    ];

    for (const selector of candidates) {
      const btn = container ? container.querySelector(selector) : null;
      if (btn && !btn.disabled && btn.offsetParent !== null) {
        return btn;
      }
    }
    return null;
  }

  function isGenerating() {
    // Check for visible stop/pause generation button
    const stopBtn = document.querySelector('button[aria-label*="stop" i], button[title*="stop" i], button[data-testid*="stop" i]');
    return !!(stopBtn && stopBtn.offsetParent !== null);
  }

  function setInputValue(el, text) {
    el.focus();
    if (el.isContentEditable) {
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      sel.collapseToEnd();
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function sendPrompt(text) {
    const input = findChatInput();
    if (!input) {
      return { ok: false, error: 'Chat input element not visible on Lovable page.' };
    }

    // Baseline marker count and length to isolate current turn from prior history
    const initialText = document.body.innerText || '';
    const initialMarkerCount = (initialText.match(/\[\[TASK_DONE\]\]/g) || []).length;
    const initialTextLength = initialText.length;

    setInputValue(input, text);
    await new Promise(r => setTimeout(r, 350));

    const btn = findSendButton();
    if (btn && !btn.disabled) {
      btn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
    }

    return await watchTurnCompletion(initialMarkerCount, initialTextLength);
  }

  async function watchTurnCompletion(initialMarkerCount = 0, initialTextLength = 0) {
    if (watching) return { ok: false, error: 'Turn watcher already active' };
    watching = true;
    const started = Date.now();
    let lastLen = -1;
    let stableCount = 0;

    // Initial buffer for assistant response initiation
    await new Promise(r => setTimeout(r, 2500));

    while (Date.now() - started < HARD_TIMEOUT_MS) {
      const visibleText = document.body.innerText || '';
      const len = visibleText.length;
      const currentMarkerCount = (visibleText.match(/\[\[TASK_DONE\]\]/g) || []).length;

      // Check explicit marker emitted specifically during this turn
      if (currentMarkerCount > initialMarkerCount) {
        break;
      }

      // Fallback completion strategy: text stabilization + generator inactive
      if (!isGenerating()) {
        if (len === lastLen) {
          stableCount++;
        } else {
          stableCount = 0;
        }

        if (stableCount >= IDLE_POLLS) {
          break; // Turn ended
        }
      } else {
        stableCount = 0;
      }

      lastLen = len;
      await new Promise(r => setTimeout(r, POLL_MS));
    }

    watching = false;
    const body = document.body.innerText || '';
    const recentOutput = body.slice(Math.max(0, initialTextLength));
    const tail = body.slice(-6000);

    const limitDetected = CREDIT_LIMIT_RE.test(tail);
    const transientError = TRANSIENT_ERROR_RE.test(tail);
    const finalMarkerCount = (body.match(/\[\[TASK_DONE\]\]/g) || []).length;
    const markerDetected = finalMarkerCount > initialMarkerCount;
    const timedOut = Date.now() - started >= HARD_TIMEOUT_MS;

    return {
      ok: true,
      limitDetected,
      transientError,
      markerDetected,
      timedOut,
      output: recentOutput.length > 0 ? recentOutput : tail
    };
  }

  // Authentication detection
  function checkAuthStatus() {
    const isLoginPath = /^\/(login|auth|signin)/i.test(location.pathname);
    const hasSignInBtn = !!document.querySelector('a[href*="/login"], a[href*="/auth"], button:has(svg.lucide-log-in)');
    const trigger = findWorkspaceTrigger();
    const hasChatInput = !!findChatInput();
    const hasUserAvatar = !!document.querySelector('[data-testid*="user-avatar" i], img[alt*="avatar" i], button[aria-label*="account" i], button[aria-label*="profile" i]');

    const authenticated = !isLoginPath && (!!trigger || !!hasChatInput || !!hasUserAvatar || !hasSignInBtn);
    return {
      ok: true,
      authenticated,
      url: location.href,
      activeWorkspace: trigger ? trigger.text : null
    };
  }

  // Workspace trigger button locator in visible Lovable UI
  function findWorkspaceTrigger() {
    const candidates = [
      'button[data-testid*="workspace-selector" i]',
      'button[data-testid*="workspace" i]',
      'button[aria-label*="workspace" i]',
      'button[aria-haspopup="menu"]:has(.lucide-chevrons-up-down)',
      'button:has(.lucide-chevrons-up-down)',
      'button:has(.lucide-chevron-down):not([data-testid*="model" i]):not([data-testid*="branch" i])',
      'header button:has(svg)',
      'nav button:has(svg)'
    ];

    for (const selector of candidates) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        if (el && !el.disabled && (el.offsetParent !== null || el.getBoundingClientRect().width > 0)) {
          const text = (el.innerText || el.textContent || '').trim().split('\n')[0].trim();
          if (text.length > 0 && !/^(new|create|deploy|share|upgrade|help|docs|preview)/i.test(text)) {
            return { element: el, text };
          }
        }
      }
    }
    return null;
  }

  // Discover real workspaces from visible Lovable UI
  async function discoverWorkspaces() {
    const auth = checkAuthStatus();
    if (!auth.authenticated) {
      return { ok: false, authenticated: false, error: 'User is not logged into Lovable in Microsoft Edge.' };
    }

    const trigger = findWorkspaceTrigger();
    const currentActive = trigger ? trigger.text : '';

    if (!trigger) {
      // If trigger is not immediately visible, check if we have an active workspace via page metadata
      return {
        ok: true,
        authenticated: true,
        workspaces: currentActive ? [{ name: currentActive, active: true }] : [],
        activeWorkspace: currentActive || null
      };
    }

    // Open workspace dropdown
    trigger.element.click();
    await new Promise(r => setTimeout(r, 450));

    // Look for dropdown / popover content
    const popoverContainers = document.querySelectorAll(
      '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [data-state="open"], div[role="dialog"]'
    );

    const workspaces = [];
    const seenNames = new Set();

    popoverContainers.forEach(container => {
      const items = container.querySelectorAll(
        '[role="menuitem"], [role="option"], [data-radix-collection-item], button, div[role="button"]'
      );

      items.forEach(item => {
        const text = (item.innerText || item.textContent || '').trim().split('\n')[0].trim();
        if (
          text.length > 0 &&
          text.length < 80 &&
          !/^(create|new|add|leave|settings|members|invite|billing|logout|sign out|switch account|help)/i.test(text)
        ) {
          if (!seenNames.has(text)) {
            seenNames.add(text);
            const hasCheck = !!item.querySelector('.lucide-check, [data-state="checked"]') ||
                             item.getAttribute('aria-checked') === 'true' ||
                             text.toLowerCase() === currentActive.toLowerCase();
            workspaces.push({
              name: text,
              active: hasCheck
            });
          }
        }
      });
    });

    // Close the dropdown cleanly
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await new Promise(r => setTimeout(r, 200));

    if (workspaces.length === 0 && currentActive) {
      workspaces.push({ name: currentActive, active: true });
    }

    return {
      ok: true,
      authenticated: true,
      workspaces,
      activeWorkspace: currentActive
    };
  }

  // Switch to a target real workspace via visible UI
  async function switchWorkspace(targetName) {
    if (!targetName) {
      return { ok: false, error: 'No target workspace name specified.' };
    }

    const trigger = findWorkspaceTrigger();
    if (trigger && trigger.text.toLowerCase() === targetName.toLowerCase()) {
      return { ok: true, alreadyActive: true, activeWorkspace: trigger.text };
    }

    if (!trigger) {
      return { ok: false, error: 'Could not locate Lovable workspace selector button.' };
    }

    // Open workspace dropdown
    trigger.element.click();
    await new Promise(r => setTimeout(r, 450));

    const popovers = document.querySelectorAll(
      '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [data-state="open"], div[role="dialog"]'
    );

    let targetItem = null;
    popovers.forEach(popover => {
      const items = popover.querySelectorAll(
        '[role="menuitem"], [role="option"], [data-radix-collection-item], button, div[role="button"]'
      );
      items.forEach(item => {
        const text = (item.innerText || item.textContent || '').trim().split('\n')[0].trim();
        if (text.toLowerCase() === targetName.toLowerCase() ||
            text.toLowerCase().includes(targetName.toLowerCase())) {
          targetItem = item;
        }
      });
    });

    if (!targetItem) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      return { ok: false, error: `Target workspace "${targetName}" not found in Lovable workspace dropdown.` };
    }

    // Click target workspace item
    targetItem.click();
    await new Promise(r => setTimeout(r, 2000));

    // Verify workspace switch
    const newTrigger = findWorkspaceTrigger();
    const verified = newTrigger && (
      newTrigger.text.toLowerCase().includes(targetName.toLowerCase()) ||
      targetName.toLowerCase().includes(newTrigger.text.toLowerCase())
    );

    if (verified) {
      return { ok: true, switched: true, activeWorkspace: newTrigger.text };
    }

    return {
      ok: false,
      error: `Workspace switch verification failed. Expected "${targetName}", active is "${newTrigger ? newTrigger.text : 'unknown'}".`
    };
  }

  // Resolve target project or open first active project
  async function resolveProject(targetProjectName = null) {
    // If chat input is already visible, we are inside a project ready for execution
    if (findChatInput()) {
      return { ok: true, ready: true, inProject: true };
    }

    // If on dashboard, find project link/card
    let projectEl = null;
    if (targetProjectName) {
      const links = Array.from(document.querySelectorAll('a[href*="/projects/"], a[href*="/c/"], div[data-testid*="project"]'));
      projectEl = links.find(el => (el.innerText || '').toLowerCase().includes(targetProjectName.toLowerCase()));
    }

    if (!projectEl) {
      // Find first available project card/link
      projectEl = document.querySelector('a[href*="/projects/"]:not([href="/projects"]), a[href*="/c/"]');
    }

    if (projectEl) {
      projectEl.click();
      // Wait for project view and chat input to load
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (findChatInput()) {
          return { ok: true, ready: true, inProject: true };
        }
      }
    }

    // Check once more
    const inputReady = !!findChatInput();
    return {
      ok: inputReady,
      ready: inputReady,
      inProject: inputReady,
      error: inputReady ? null : 'Could not resolve Lovable project or chat input element.'
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'CHECK_AUTH') {
      respond(checkAuthStatus());
      return true;
    }

    if (msg.type === 'DISCOVER_WORKSPACES') {
      discoverWorkspaces().then(respond).catch(err => {
        respond({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === 'SWITCH_WORKSPACE') {
      switchWorkspace(msg.targetName).then(respond).catch(err => {
        respond({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === 'RESOLVE_PROJECT') {
      resolveProject(msg.projectName).then(respond).catch(err => {
        respond({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === 'CHECK_LIMIT_SIGNAL') {
      const tail = (document.body.innerText || '').slice(-6000);
      respond({ ok: true, limitDetected: CREDIT_LIMIT_RE.test(tail) });
      return true;
    }

    if (msg.type === 'DISPATCH_PROMPT') {
      sendPrompt(msg.prompt).then(respond).catch(err => {
        respond({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === 'PROBE') {
      const auth = checkAuthStatus();
      respond({
        ok: true,
        authenticated: auth.authenticated,
        activeWorkspace: auth.activeWorkspace,
        hasInput: !!findChatInput(),
        hasSend: !!findSendButton(),
        isGenerating: isGenerating(),
        url: location.href
      });
      return true;
    }
  });

  chrome.runtime.sendMessage({ type: 'BRIDGE_READY', url: location.href }).catch(() => {});
})();
