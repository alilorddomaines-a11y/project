/**
 * extension/ui/dashboard.js
 * Interactive controller for KDP Coloring Book Factory dashboard.
 */

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
    console.warn('Direct extension messaging unavailable; using local simulation cache', e);
  }
}

// 3. Render View Elements
function renderAll() {
  renderDashboard();
  renderWorkspaces();
  renderTaskQueue();
  renderLogs();
}

function renderDashboard() {
  const state = currentData.state;
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
    div.textContent = `[${log.time}] ${log.message}`;
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
$('#btnStart')?.addEventListener('click', () => {
  $('#createBookForm')?.requestSubmit();
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

// Create Book Form
$('#createBookForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const spec = {
    title: $('#bookTitle').value.trim(),
    subtitle: $('#bookSubtitle').value.trim(),
    language: $('#bookLanguage').value,
    targetAge: $('#targetAge').value,
    pages: parseInt($('#pageCount').value, 10) || 10,
    trimSize: $('#trimSize').value,
    blankBacks: $('#chkBlankBacks').checked,
    frontMatter: $('#chkFrontMatter').checked,
    theme: $('#theme').value.trim(),
    complexity: $('#complexity').value
  };

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({ type: 'START_PROJECT', spec });
    $$('.nav-item')[0].click(); // Go to dashboard tab
    fetchData();
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
    alert('15-Workspace configuration saved successfully.');
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
