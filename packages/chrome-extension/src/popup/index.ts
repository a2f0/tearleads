import {
  MessageType,
  type PingResponse,
  type TabInfoResponse
} from '../messages';

function showStatus(message: string, type: 'success' | 'error') {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    setTimeout(() => {
      statusEl.className = 'status';
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const titleEl = document.getElementById('page-title');
  const urlEl = document.getElementById('page-url');
  const actionBtn = document.getElementById('action-btn');

  chrome.runtime.sendMessage(
    { type: MessageType.GET_TAB_INFO },
    (response: TabInfoResponse | undefined) => {
      if (titleEl) titleEl.textContent = response?.title ?? 'Unknown';
      if (urlEl) urlEl.textContent = response?.url ?? 'Unknown';
    }
  );

  actionBtn?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        chrome.tabs.sendMessage(
          tab.id,
          { type: MessageType.PING },
          (response: PingResponse | undefined) => {
            if (response?.status === 'ok') {
              showStatus('Content script is active!', 'success');
            } else {
              showStatus('Content script not responding', 'error');
            }
          }
        );
      }
    });
  });
});
