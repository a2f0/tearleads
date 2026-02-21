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

describe('popup script - DOM edge cases', () => {
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
