/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../messages';

const mockRuntimeSendMessage = vi.fn();
const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

let runtimeLastErrorMessage: string | undefined;

const mockChrome = {
  runtime: {
    sendMessage: mockRuntimeSendMessage,
    get lastError() {
      if (runtimeLastErrorMessage === undefined) {
        return undefined;
      }

      return { message: runtimeLastErrorMessage };
    }
  },
  tabs: {
    query: mockTabsQuery,
    sendMessage: mockTabsSendMessage
  }
};

vi.stubGlobal('chrome', mockChrome);
globalThis.__tearleadsPopupInitialized = undefined;

function setupDOM() {
  document.body.innerHTML = `
    <div id="page-title">Loading...</div>
    <div id="page-url">Loading...</div>
    <button id="action-btn">Activate On This Tab</button>
    <div id="status" class="status"></div>
  `;
}

function triggerDOMContentLoaded() {
  const event = new Event('DOMContentLoaded', {
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(event);
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function defaultRuntimeMessageMock() {
  mockRuntimeSendMessage.mockImplementation((message, callback) => {
    if (message.type === MessageType.GET_TAB_INFO) {
      callback({ title: 'Test Page', url: 'https://test.com' });
      return;
    }

    callback(undefined);
  });
}

describe('popup script - content script activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();
    runtimeLastErrorMessage = undefined;
    setupDOM();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    runtimeLastErrorMessage = undefined;
    document.body.innerHTML = '';
  });

  it('should show success status when content script responds to ping', async () => {
    defaultRuntimeMessageMock();
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      callback({ status: 'ok' });
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    expect(mockTabsQuery).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function)
    );
    expect(mockTabsSendMessage).toHaveBeenCalledWith(
      123,
      { type: MessageType.PING },
      expect.any(Function)
    );

    const injectCalls = mockRuntimeSendMessage.mock.calls.filter(
      ([message]) => message.type === MessageType.INJECT_CONTENT_SCRIPT
    );

    expect(injectCalls).toHaveLength(0);

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Content script is active on this tab.');
    expect(statusEl?.className).toBe('status success');
  });

  it('should inject content script when initial ping fails and then succeed', async () => {
    defaultRuntimeMessageMock();
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type === MessageType.GET_TAB_INFO) {
        callback({ title: 'Test Page', url: 'https://test.com' });
        return;
      }

      if (message.type === MessageType.INJECT_CONTENT_SCRIPT) {
        callback({ status: 'injected' });
      }
    });

    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });

    let pingCallCount = 0;
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      pingCallCount += 1;

      if (pingCallCount === 1) {
        runtimeLastErrorMessage =
          'Could not establish connection. Receiving end does not exist.';
        callback(undefined);
        runtimeLastErrorMessage = undefined;
        return;
      }

      callback({ status: 'ok' });
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    expect(pingCallCount).toBe(2);
    expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
      { type: MessageType.INJECT_CONTENT_SCRIPT },
      expect.any(Function)
    );

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Content script is active on this tab.');
    expect(statusEl?.className).toBe('status success');
  });

  it('should inject when ping response is present but not ok', async () => {
    defaultRuntimeMessageMock();
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type === MessageType.GET_TAB_INFO) {
        callback({ title: 'Test Page', url: 'https://test.com' });
        return;
      }

      callback({ status: 'injected' });
    });

    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });

    let pingCallCount = 0;
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      pingCallCount += 1;

      if (pingCallCount === 1) {
        callback({ status: 'not-ok' });
        return;
      }

      callback({ status: 'ok' });
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    expect(pingCallCount).toBe(2);
    expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
      { type: MessageType.INJECT_CONTENT_SCRIPT },
      expect.any(Function)
    );

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Content script is active on this tab.');
    expect(statusEl?.className).toBe('status success');
  });
});
