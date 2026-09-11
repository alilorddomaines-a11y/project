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
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'form textarea',
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
    const container = input ? input.closest('form, div:has(textarea)') : document;

    const candidates = [
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[title*="send" i]',
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
    const stopBtn = document.querySelector('button[aria-label*="stop" i], button[title*="stop" i]');
    return !!(stopBtn && stopBtn.offsetParent !== null);
  }

  function setInputValue(el, text) {
    el.focus();
    if (el.isContentEditable) {
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      sel.collapseToEnd();
      document.execCommand('insertText', false, text);
      return;
    }
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
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

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
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
      respond({
        ok: true,
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
