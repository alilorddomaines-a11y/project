/**
 * extension/ui/dashboard.js
 * Interactive controller for KDP Coloring Book Factory dashboard.
 * Uses the canonical BookSpec engine for deterministic specification creation.
 */

import { BookSpec } from '../../kdp/BookSpec.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let currentData = {
  state: null,
  tasks: [],
  workspaces: [],
  logs: [],
  driverType: 'simulation'
};

// 1. Tab Switching Navigation
$$('.nav-item').forEach(button => {
  button.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    $$('.tab-pane').forEach(p => p.classList.remove('active'));

    button.classList.add('active');
    const tabId = `tab-${button.dataset.tab}`;
    const pane = $(`#${tabId}`);
    if (pane) pane.classList.add('active');

    $('#pageTitle').textContent = button.textContent.trim();
  });
});

// 2. Load Data from Service Worker
async function fetchData() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const res = await chrome.runtime.sendMessage({ type: 'GET_DATA' });
      if (res) {
        currentData = res;
        renderAll();
      }
    }
  } catch (e) {
    console.warn('Direct extension messaging unavailable; using local cache', e);
  }
}

// 3. Render View Elements
function renderAll() {
  renderDashboard();
  renderWorkspaces();
  renderTaskQueue();
  renderLogs();
  renderSettings();
}

function renderSettings() {
  const driverSel = $('#driverSelect');
  if (driverSel && !driverSel.matches(':focus') && currentData.driverType) {
    driverSel.value = currentData.driverType;
  }
}

function renderDashboard() {
  const driverLabel = $('#activeDriverLabel');
  if (driverLabel && currentData.driverType) {
    const dName = currentData.driverType === 'browser' ? 'Edge Browser Driver' :
                  currentData.driverType === 'mcp' ? 'Lovable MCP Driver' : 'Simulation Driver';
    driverLabel.textContent = `Driver: ${dName}`;
  }

  const state = currentData.state;
  const isExhausted = currentData.isExhausted || (state?.status === 'PAUSED' && currentData.workspaces.length > 0 && currentData.workspaces.every(w => !w.enabled || w.status === 'UNAVAILABLE_FOR_RUN'));
  const banner = $('#exhaustedBanner');
  if (banner) {
    banner.style.display = isExhausted ? 'block' : 'none';
  }

  if (!state) {
    $('#statBookTitle').textContent = 'No Project Active';
    $('#activeProjectPill').textContent = 'IDLE';
    $('#statProgressPercent').textContent = '0%';
    $('#statProgressBar').style.width = '0%';
    return;
  }

  $('#statBookTitle').textContent = state.book_title || 'Untitled';
  $('#activeProjectPill').textContent = state.status;
  $('#statAudience').textContent = `Phase: ${state.phase}`;
  $('#statWorkspace').textContent = state.current_workspace || 'WS01';
  $('#statCommit').textContent = state.last_commit ? state.last_commit.substring(0, 7) : 'HEAD';

  const total = currentData.tasks.length;
  const completed = (state.completed_tasks || []).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  $('#statProgressPercent').textContent = `${pct}%`;
  $('#statProgressBar').style.width = `${pct}%`;

  $('#infoPhase').textContent = state.phase;
  $('#infoTask').textContent = state.current_task || 'None';
  $('#infoStatus').textContent = state.status;
  $('#infoAssets').textContent = (state.assets_created || []).length;
}

function renderWorkspaces() {
  const tbody = $('#workspacesTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  currentData.workspaces.forEach((ws, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${ws.order || idx + 1}</strong></td>
      <td><code>${ws.id}</code></td>
      <td><input type="text" class="ws-name-input" data-id="${ws.id}" value="${ws.name}"></td>
      <td><span class="badge ${ws.status === 'ACTIVE' ? 'badge-success' : ws.status === 'UNAVAILABLE_FOR_RUN' ? 'badge-warning' : 'badge-neutral'}">${ws.status}</span></td>
      <td><input type="checkbox" class="ws-enable-toggle" data-id="${ws.id}" ${ws.enabled ? 'checked' : ''}></td>
      <td><input type="text" class="ws-url-input" data-id="${ws.id}" value="${ws.url}" style="width: 100%;"></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTaskQueue() {
  const tbody = $('#taskQueueTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  $('#queueCountBadge').textContent = `${currentData.tasks.length} Tasks`;

  currentData.tasks.forEach(task => {
    const tr = document.createElement('tr');
    const badgeClass =
      task.status === 'SUCCESS' ? 'badge-success' :
      task.status === 'RUNNING' ? 'badge-warning' :
      task.status === 'BLOCKED' ? 'badge-danger' : 'badge-neutral';

    tr.innerHTML = `
      <td><code>${task.id}</code></td>
      <td><small>${task.type}</small></td>
      <td>${task.description}</td>
      <td>${task.priority}</td>
      <td><span class="badge ${badgeClass}">${task.status}</span></td>
      <td><code>${task.workspace || '—'}</code></td>
      <td>${task.attempts || 0}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderLogs() {
  const stream = $('#logsStream');
  const mini = $('#miniLogsList');
  if (!stream) return;

  stream.innerHTML = '';
  if (mini) mini.innerHTML = '';

  currentData.logs.slice(0, 100).forEach(log => {
    const div = document.createElement('div');
    div.className = `log-entry ${log.type || 'info'}`;
    div.textContent = `[${log.time}] [${log.event || 'INFO'}] ${log.message}`;
    stream.appendChild(div);

    if (mini && mini.children.length < 6) {
      const miniDiv = document.createElement('div');
      miniDiv.className = `log-entry ${log.type || 'info'}`;
      miniDiv.textContent = `[${log.time}] ${log.message}`;
      mini.appendChild(miniDiv);
    }
  });
}

// 4. Bind Control Buttons
$('#btnCreateBookNav')?.addEventListener('click', () => {
  $$('.nav-item').forEach(b => {
    if (b.dataset.tab === 'create-book') b.click();
  });
});

$('#btnStart')?.addEventListener('click', () => {
  if (currentData.state && currentData.state.status === 'PAUSED') {
    $('#btnResume')?.click();
  } else {
    $('#btnCreateBookNav')?.click();
  }
});

$('#btnPause')?.addEventListener('click', async () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({ type: 'PAUSE_PROJECT' });
    fetchData();
  }
});

$('#btnResume')?.addEventListener('click', async () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({ type: 'RESUME_PROJECT' });
    fetchData();
  }
});

$('#btnStop')?.addEventListener('click', async () => {
  if (confirm('Stop the KDP Factory and save state checkpoint?')) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({ type: 'STOP_PROJECT' });
      fetchData();
    }
  }
});

$('#btnResetTestRun')?.addEventListener('click', async () => {
  if (confirm('Reset the test run? This resets workspace statuses and in-memory queue without modifying canonical Git history.')) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({ type: 'RESET_TEST_RUN' });
      fetchData();
    }
  }
});

function addLocalLog(message, type = 'info', eventType = 'INFO') {
  const entry = {
    time: new Date().toLocaleTimeString(),
    type,
    event: eventType,
    message
  };
  currentData.logs = currentData.logs || [];
  currentData.logs.unshift(entry);
  if (currentData.logs.length > 250) currentData.logs.pop();
  renderLogs();
}

async function handleCreateBookSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  console.log('[CREATE_BOOK] button clicked');
  addLocalLog('[CREATE_BOOK] button clicked', 'info', 'CREATE_BOOK');

  const errBox = $('#specErrorsContainer');
  if (errBox) {
    errBox.style.display = 'none';
    errBox.innerHTML = '';
  }

  const rawFormData = {
    book_title: $('#bookTitle')?.value?.trim() || '',
    subtitle: $('#bookSubtitle')?.value?.trim() || '',
    language: $('#bookLanguage')?.value || 'en',
    target_age: $('#targetAge')?.value || '4-8',
    theme: $('#theme')?.value?.trim() || '',
    page_count: $('#pageCount')?.value || '10',
    trim_size: $('#trimSize')?.value || '8.5x11',
    orientation: $('#orientation')?.value || 'PORTRAIT',
    bleed: $('#bleed')?.value || 'NO_BLEED',
    complexity: $('#complexity')?.value || 'SIMPLE',
    style: $('#style')?.value || 'CLEAN_LINE_ART',
    background: $('#background')?.value || 'WHITE',
    blank_back_pages: $('#chkBlankBacks')?.checked ?? true,
    page_numbering: $('#chkPageNumbers')?.checked ?? false,
    front_matter: {
      title_page: $('#chkTitlePage')?.checked ?? true,
      copyright_page: $('#chkCopyrightPage')?.checked ?? true,
      introduction_page: $('#chkIntroPage')?.checked ?? true,
      instructions_page: $('#chkInstructionsPage')?.checked ?? false
    },
    activity_pages: {
      enabled: $('#chkActivityPages')?.checked ?? false,
      count: Number($('#activityPagesCount')?.value) || 0
    }
  };

  try {
    console.log('[CREATE_BOOK] validation started');
    addLocalLog('[CREATE_BOOK] validation started', 'info', 'CREATE_BOOK');

    // Validated, normalized, deterministic BookSpec
    const spec = BookSpec.create(rawFormData);
    console.log('[CREATE_BOOK] BookSpec created:', spec.book_title);
    addLocalLog(`[CREATE_BOOK] BookSpec created: "${spec.book_title}"`, 'info', 'CREATE_BOOK');

    // Immediate visual state change on dashboard to guarantee no silent freezes
    $('#statBookTitle').textContent = spec.book_title;
    $('#activeProjectPill').textContent = 'INITIALIZING';
    $('#infoStatus').textContent = 'INITIALIZING';
    $('#statWorkspace').textContent = 'WS01';

    const driverType = $('#driverSelect')?.value || currentData.driverType || 'browser';
    console.log('[CREATE_BOOK] sending START_PROJECT to service worker with driver:', driverType);
    addLocalLog(`[CREATE_BOOK] sending START_PROJECT with driver: ${driverType}`, 'info', 'CREATE_BOOK');

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const res = await chrome.runtime.sendMessage({
        type: 'START_PROJECT',
        spec: spec.toJSON(),
        driverType
      });

      console.log('[CREATE_BOOK] service worker response:', res);
      if (!res || !res.ok) {
        throw new Error(res?.error || 'Background service worker failed to start project.');
      }

      // Switch to dashboard view
      $$('.nav-item')[0].click();
      await fetchData();
    } else {
      throw new Error('Chrome runtime extension messaging not available in this window.');
    }
  } catch (err) {
    console.error('[ERROR] [CREATE_BOOK]', err);
    addLocalLog(`[ERROR] [CREATE_BOOK] ${err.message}`, 'error', 'ERROR');

    if (errBox) {
      errBox.style.display = 'block';
      if (err.validation?.errors) {
        errBox.innerHTML = `<strong>Specification Errors:</strong><ul style="margin: 6px 0 0 18px;">${err.validation.errors.map(e => `<li>${e.message}</li>`).join('')}</ul>`;
      } else {
        errBox.innerHTML = `<strong>Error:</strong> ${err.message}`;
      }
    }
    alert(`Create Book Failed:\n${err.message}`);
  }
}

// Create Book Form with deterministic BookSpec validation
$('#createBookForm')?.addEventListener('submit', handleCreateBookSubmit);
$('#btnSubmitCreateBook')?.addEventListener('click', (e) => {
  // If the button is clicked outside standard submit event, trigger submission
  const form = $('#createBookForm');
  if (form && !form.checkValidity()) {
    form.reportValidity();
  }
});


// Save Workspaces
$('#btnSaveWorkspaces')?.addEventListener('click', async () => {
  const updatedWorkspaces = [...currentData.workspaces];
  $$('.ws-name-input').forEach(input => {
    const ws = updatedWorkspaces.find(w => w.id === input.dataset.id);
    if (ws) ws.name = input.value.trim();
  });
  $$('.ws-enable-toggle').forEach(input => {
    const ws = updatedWorkspaces.find(w => w.id === input.dataset.id);
    if (ws) ws.enabled = input.checked;
  });
  $$('.ws-url-input').forEach(input => {
    const ws = updatedWorkspaces.find(w => w.id === input.dataset.id);
    if (ws) ws.url = input.value.trim();
  });

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({ type: 'UPDATE_WORKSPACES', workspaces: updatedWorkspaces });
    alert('20-Workspace configuration saved successfully.');
    fetchData();
  }
});

// Save Settings
$('#btnSaveSettings')?.addEventListener('click', async () => {
  const driverType = $('#driverSelect')?.value || 'simulation';
  const maxRetries = Number($('#maxRetriesInput')?.value) || 3;

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({
      type: 'SET_DRIVER',
      driverType,
      options: { maxRetries }
    });
    const dName = driverType === 'browser' ? 'Edge Browser Driver' : driverType === 'mcp' ? 'Lovable MCP Driver' : 'Simulation Driver';
    alert(`Settings saved. Active Driver: ${dName}`);
    fetchData();
  }
});


// Listen for updates from service worker
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'STATE_UPDATED' || msg.type === 'LOG_APPENDED') {
      fetchData();
    }
  });
}

// Initial fetch and auto-refresh
fetchData();
setInterval(fetchData, 2000);
