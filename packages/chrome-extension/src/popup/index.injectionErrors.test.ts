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

describe('popup script - injection errors', () => {
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
});
