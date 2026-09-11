/**
 * extension/content/lovable_bridge.js
 * Non-intrusive DOM bridge injected into https://lovable.dev/*
 * Observes chat interactions and legitimate UI notices within the user's authenticated session.
 * NO private API scraping, token extraction, or limit circumvention.
 */

(() => {
  const IDLE_POLLS = 5;
  const POLL_MS = 900;
  const HARD_TIMEOUT_MS = 15 * 60 * 1000;

  // Legitimate UI limit detection regex matching visible browser text
  const CREDIT_LIMIT_RE = /(out of credits|no credits (left|remaining)|credit limit|monthly limit reached|you(?:'|’)ve used all|upgrade (your )?plan to continue|daily limit)/i;
  const TRANSIENT_ERROR_RE = /(something went wrong|rate limit|too many requests|failed to generate)/i;

  let watching = false;

  function findInput() {
    return document.querySelector('form textarea, textarea[placeholder], div[contenteditable="true"], textarea');
  }

  function findSendButton() {
    const input = findInput();
    const form = input?.closest('form');
    return form?.querySelector('button[type="submit"], button:has(svg)') || document.querySelector('button[type="submit"]');
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
    const input = findInput();
    if (!input) return { ok: false, error: 'Chat input element not found in Lovable page.' };

    setInputValue(input, text);
    await new Promise(r => setTimeout(r, 300));

    const btn = findSendButton();
    if (btn && !btn.disabled) {
      btn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
    }

    return await watchTurnCompletion();
  }

  async function watchTurnCompletion() {
    if (watching) return { ok: false, error: 'Turn watcher already active' };
    watching = true;
    const started = Date.now();
    let lastLen = -1;
    let stillCount = 0;

    await new Promise(r => setTimeout(r, 2500));

    while (Date.now() - started < HARD_TIMEOUT_MS) {
      const text = document.body.innerText || '';
      stillCount = (text.length === lastLen) ? stillCount + 1 : 0;
      lastLen = text.length;

      // Check if turn marker has appeared
      if (text.includes('[[TASK_DONE]]')) {
        break;
      }

      // Check if text has stopped growing for IDLE_POLLS
      if (stillCount >= IDLE_POLLS) {
        break;
      }

      await new Promise(r => setTimeout(r, POLL_MS));
    }

    watching = false;
    const body = document.body.innerText || '';
    const tail = body.slice(-5000);

    const limitDetected = CREDIT_LIMIT_RE.test(tail);
    const transientError = TRANSIENT_ERROR_RE.test(tail);
    const markerDetected = body.includes('[[TASK_DONE]]');

    return {
      ok: true,
      limitDetected,
      transientError,
      markerDetected,
      output: body.slice(-8000)
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'CHECK_LIMIT_SIGNAL') {
      const text = document.body.innerText || '';
      const limitDetected = CREDIT_LIMIT_RE.test(text.slice(-5000));
      respond({ ok: true, limitDetected });
      return true;
    }

    if (msg.type === 'DISPATCH_PROMPT') {
      sendPrompt(msg.prompt).then(respond);
      return true;
    }

    if (msg.type === 'PROBE') {
      respond({
        ok: true,
        hasInput: !!findInput(),
        hasSend: !!findSendButton(),
        url: location.href
      });
      return true;
    }
  });

  console.log('[KDP Factory] Lovable DOM bridge initialized.');
})();
