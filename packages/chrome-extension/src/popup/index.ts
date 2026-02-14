import {
  MessageType,
  type InjectContentScriptResponse,
  type InjectContentScriptRequest,
  type PingRequest,
  type PingResponse,
  type TabInfoRequest,
  type TabInfoResponse
} from '../messages';

declare global {
  var __tearleadsPopupInitialized: boolean | undefined;
}

const STATUS_TIMEOUT_MS = 3000;

let statusTimeoutId: ReturnType<typeof setTimeout> | undefined;

function showStatus(message: string, type: 'success' | 'error') {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;

    if (statusTimeoutId !== undefined) {
      clearTimeout(statusTimeoutId);
    }

    statusTimeoutId = setTimeout(() => {
      statusEl.className = 'status';
      statusTimeoutId = undefined;
    }, STATUS_TIMEOUT_MS);
  }
}

function toErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return undefined;
}

function sendRuntimeMessage<TResponse>(
  message: TabInfoRequest | InjectContentScriptRequest
): Promise<TResponse | undefined> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse | undefined) => {
      const runtimeErrorMessage = chrome.runtime.lastError?.message;
      if (runtimeErrorMessage) {
        reject(new Error(runtimeErrorMessage));
        return;
      }

      resolve(response);
    });
  });
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeErrorMessage = chrome.runtime.lastError?.message;
      if (runtimeErrorMessage) {
        reject(new Error(runtimeErrorMessage));
        return;
      }

      resolve(tabs[0]);
    });
  });
}

function sendTabMessage<TResponse>(
  tabId: number,
  message: PingRequest
): Promise<TResponse | undefined> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: TResponse | undefined) => {
      const runtimeErrorMessage = chrome.runtime.lastError?.message;
      if (runtimeErrorMessage) {
        reject(new Error(runtimeErrorMessage));
        return;
      }

      resolve(response);
    });
  });
}

async function fetchCurrentTabInfo(): Promise<TabInfoResponse | undefined> {
  const request: TabInfoRequest = { type: MessageType.GET_TAB_INFO };
  return sendRuntimeMessage<TabInfoResponse>(request);
}

async function pingContentScript(tabId: number): Promise<PingResponse | undefined> {
  const request: PingRequest = { type: MessageType.PING };
  return sendTabMessage<PingResponse>(tabId, request);
}

async function injectContentScript(): Promise<
  InjectContentScriptResponse | undefined
> {
  const request: InjectContentScriptRequest = {
    type: MessageType.INJECT_CONTENT_SCRIPT
  };
  return sendRuntimeMessage<InjectContentScriptResponse>(request);
}

async function ensureContentScriptActive(tabId: number): Promise<boolean> {
  try {
    const pingResponse = await pingContentScript(tabId);
    if (pingResponse?.status === 'ok') {
      return true;
    }
  } catch (_error) {
    // Ignore initial ping failure and attempt injection fallback.
  }

  const injectionResponse = await injectContentScript();
  if (injectionResponse?.status !== 'injected') {
    const errorMessage =
      injectionResponse?.error ?? 'Unable to activate content script.';
    showStatus(errorMessage, 'error');
    return false;
  }

  try {
    const pingResponse = await pingContentScript(tabId);
    if (pingResponse?.status === 'ok') {
      return true;
    }
  } catch (error) {
    showStatus(
      toErrorMessage(error) ?? 'Content script did not respond after injection.',
      'error'
    );
    return false;
  }

  showStatus('Content script did not respond after injection.', 'error');
  return false;
}

function onDomContentLoaded() {
  const titleEl = document.getElementById('page-title');
  const urlEl = document.getElementById('page-url');
  const actionBtn = document.getElementById('action-btn');

  fetchCurrentTabInfo()
    .then((response) => {
      if (titleEl) titleEl.textContent = response?.title ?? 'Unknown';
      if (urlEl) urlEl.textContent = response?.url ?? 'Unknown';
    })
    .catch(() => {
      if (titleEl) titleEl.textContent = 'Unknown';
      if (urlEl) urlEl.textContent = 'Unknown';
    });

  actionBtn?.addEventListener('click', async () => {
    if (!(actionBtn instanceof HTMLButtonElement)) {
      return;
    }

    actionBtn.disabled = true;

    try {
      const tab = await queryActiveTab();
      if (tab?.id === undefined) {
        showStatus('No active tab found.', 'error');
        return;
      }

      const isActive = await ensureContentScriptActive(tab.id);
      if (isActive) {
        showStatus('Content script is active on this tab.', 'success');
      }
    } catch (error) {
      showStatus(toErrorMessage(error) ?? 'Unable to query active tab.', 'error');
    } finally {
      actionBtn.disabled = false;
    }
  });
}

if (!globalThis.__tearleadsPopupInitialized) {
  globalThis.__tearleadsPopupInitialized = true;
  document.addEventListener('DOMContentLoaded', onDomContentLoaded);
}
