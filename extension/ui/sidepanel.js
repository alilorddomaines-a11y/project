/**
 * extension/ui/sidepanel.js
 * Edge side panel quick-control widget.
 */

const $ = s => document.querySelector(s);

async function refreshPanel() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const data = await chrome.runtime.sendMessage({ type: 'GET_DATA' });
      if (!data) return;

      const state = data.state;
      if (state) {
        $('#pStatus').textContent = state.status;
        $('#pTitle').textContent = state.book_title;
        $('#pWorkspace').textContent = state.current_workspace;
        $('#pTask').textContent = state.current_task || 'Complete';

        const total = (data.tasks || []).length;
        const completed = (state.completed_tasks || []).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        $('#pProgress').style.width = `${pct}%`;
      }

      const stream = $('#pLogs');
      if (stream && data.logs) {
        stream.innerHTML = '';
        data.logs.slice(0, 15).forEach(l => {
          const div = document.createElement('div');
          div.className = `log-entry ${l.type || 'info'}`;
          div.textContent = `[${l.time}] ${l.message}`;
          stream.appendChild(div);
        });
      }
    } catch {}
  }
}

$('#btnOpenFull')?.addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/dashboard.html') });
  }
});

$('#btnPPause')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'PAUSE_PROJECT' }));
$('#btnPResume')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'RESUME_PROJECT' }));
$('#btnPStop')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_PROJECT' }));

refreshPanel();
setInterval(refreshPanel, 2000);
