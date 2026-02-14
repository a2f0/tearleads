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

describe('popup script', () => {
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

  it('should request tab info on DOMContentLoaded', async () => {
    defaultRuntimeMessageMock();

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
      { type: MessageType.GET_TAB_INFO },
      expect.any(Function)
    );
  });

  it('should display tab info in DOM elements', async () => {
    defaultRuntimeMessageMock();

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    expect(document.getElementById('page-title')?.textContent).toBe(
      'Test Page'
    );
    expect(document.getElementById('page-url')?.textContent).toBe(
      'https://test.com'
    );
  });

  it('should display Unknown when tab info request fails', async () => {
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type !== MessageType.GET_TAB_INFO) {
        callback(undefined);
        return;
      }

      runtimeLastErrorMessage = 'Background unavailable';
      callback(undefined);
      runtimeLastErrorMessage = undefined;
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    expect(document.getElementById('page-title')?.textContent).toBe('Unknown');
    expect(document.getElementById('page-url')?.textContent).toBe('Unknown');
  });

  it('should display Unknown when tab info response is undefined', async () => {
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type === MessageType.GET_TAB_INFO) {
        callback(undefined);
        return;
      }

      callback(undefined);
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    expect(document.getElementById('page-title')?.textContent).toBe('Unknown');
    expect(document.getElementById('page-url')?.textContent).toBe('Unknown');
  });

  it('should display Unknown when tab info fields are undefined', async () => {
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type === MessageType.GET_TAB_INFO) {
        callback({ title: undefined, url: undefined });
        return;
      }

      callback(undefined);
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    expect(document.getElementById('page-title')?.textContent).toBe('Unknown');
    expect(document.getElementById('page-url')?.textContent).toBe('Unknown');
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

  it('should show injection error when fallback activation fails', async () => {
    defaultRuntimeMessageMock();
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type === MessageType.GET_TAB_INFO) {
        callback({ title: 'Test Page', url: 'https://test.com' });
        return;
      }

      callback({
        status: 'failed',
        error: 'Cannot access contents of this page.'
      });
    });

    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      runtimeLastErrorMessage =
        'Could not establish connection. Receiving end does not exist.';
      callback(undefined);
      runtimeLastErrorMessage = undefined;
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Cannot access contents of this page.');
    expect(statusEl?.className).toBe('status error');
  });

  it('should show default injection error when fallback does not include details', async () => {
    defaultRuntimeMessageMock();
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type === MessageType.GET_TAB_INFO) {
        callback({ title: 'Test Page', url: 'https://test.com' });
        return;
      }

      callback({ status: 'failed' });
    });

    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      runtimeLastErrorMessage =
        'Could not establish connection. Receiving end does not exist.';
      callback(undefined);
      runtimeLastErrorMessage = undefined;
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Unable to activate content script.');
    expect(statusEl?.className).toBe('status error');
  });

  it('should show default error when ping still fails after injection', async () => {
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
        runtimeLastErrorMessage =
          'Could not establish connection. Receiving end does not exist.';
        callback(undefined);
        runtimeLastErrorMessage = undefined;
        return;
      }

      callback(undefined);
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe(
      'Content script did not respond after injection.'
    );
    expect(statusEl?.className).toBe('status error');
  });

  it('should show no active tab error when query returns no tabs', async () => {
    defaultRuntimeMessageMock();
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([]);
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    expect(mockTabsSendMessage).not.toHaveBeenCalled();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('No active tab found.');
    expect(statusEl?.className).toBe('status error');
  });

  it('should show query error when tabs.query fails', async () => {
    defaultRuntimeMessageMock();
    mockTabsQuery.mockImplementation((_query, callback) => {
      runtimeLastErrorMessage = 'Query failed';
      callback([]);
      runtimeLastErrorMessage = undefined;
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Query failed');
    expect(statusEl?.className).toBe('status error');
  });

  it('should show post-injection ping runtime error message', async () => {
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
        runtimeLastErrorMessage =
          'Could not establish connection. Receiving end does not exist.';
        callback(undefined);
        runtimeLastErrorMessage = undefined;
        return;
      }

      runtimeLastErrorMessage = 'Post-injection ping failed';
      callback(undefined);
      runtimeLastErrorMessage = undefined;
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Post-injection ping failed');
    expect(statusEl?.className).toBe('status error');
  });

  it('should show default post-injection error for non-error failures', async () => {
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
        runtimeLastErrorMessage =
          'Could not establish connection. Receiving end does not exist.';
        callback(undefined);
        runtimeLastErrorMessage = undefined;
        return;
      }

      throw 'ping-failed';
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe(
      'Content script did not respond after injection.'
    );
    expect(statusEl?.className).toBe('status error');
  });

  it('should show fallback query error for non-error rejections', async () => {
    defaultRuntimeMessageMock();
    mockTabsQuery.mockImplementation(() => {
      throw 'not-an-error';
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.click();
    await flushAsyncWork();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Unable to query active tab.');
    expect(statusEl?.className).toBe('status error');
  });

  it('should skip click handling when action element is not a button', async () => {
    document.body.innerHTML = `
      <div id="page-title">Loading...</div>
      <div id="page-url">Loading...</div>
      <div id="action-btn"></div>
      <div id="status" class="status"></div>
    `;
    defaultRuntimeMessageMock();

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();

    document.getElementById('action-btn')?.dispatchEvent(new Event('click'));
    await flushAsyncWork();

    expect(mockTabsQuery).not.toHaveBeenCalled();
  });

  it('should handle missing status element during activation', async () => {
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

    document.getElementById('status')?.remove();

    expect(() => document.getElementById('action-btn')?.click()).not.toThrow();
    await flushAsyncWork();
  });

  it('should clear status after timeout', async () => {
    vi.useFakeTimers();

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

    const statusEl = document.getElementById('status');
    expect(statusEl?.className).toBe('status success');

    vi.advanceTimersByTime(3000);

    expect(statusEl?.className).toBe('status');
  });

  it('should handle missing DOM elements gracefully', async () => {
    document.body.innerHTML = '';
    defaultRuntimeMessageMock();

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();
  });

  it('should handle tab info failures when title and url elements are missing', async () => {
    document.body.innerHTML = `
      <button id="action-btn">Activate On This Tab</button>
      <div id="status" class="status"></div>
    `;
    mockRuntimeSendMessage.mockImplementation((message, callback) => {
      if (message.type !== MessageType.GET_TAB_INFO) {
        callback(undefined);
        return;
      }

      runtimeLastErrorMessage = 'Background unavailable';
      callback(undefined);
      runtimeLastErrorMessage = undefined;
    });

    await import('./index');
    triggerDOMContentLoaded();
    await flushAsyncWork();
  });
});
