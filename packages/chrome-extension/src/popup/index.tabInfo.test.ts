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

describe('popup script - tab info', () => {
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
});
