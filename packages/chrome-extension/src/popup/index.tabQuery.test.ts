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

describe('popup script - tab query errors', () => {
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
});
