import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../messages';

const mockSendResponse = vi.fn();
const mockTabsQuery = vi.fn();
const mockScriptingExecuteScript = vi.fn();

let runtimeLastErrorMessage: string | undefined;

const mockChrome = {
  runtime: {
    onInstalled: {
      addListener: vi.fn()
    },
    onMessage: {
      addListener: vi.fn()
    },
    get lastError() {
      if (runtimeLastErrorMessage === undefined) {
        return undefined;
      }

      return { message: runtimeLastErrorMessage };
    }
  },
  tabs: {
    query: mockTabsQuery
  },
  scripting: {
    executeScript: mockScriptingExecuteScript
  }
};

vi.stubGlobal('chrome', mockChrome);

function withRuntimeLastError(message: string | undefined, callback: () => void) {
  runtimeLastErrorMessage = message;
  callback();
  runtimeLastErrorMessage = undefined;
}

describe('background script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runtimeLastErrorMessage = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    runtimeLastErrorMessage = undefined;
  });

  it('should register onInstalled listener', async () => {
    await import('./index');

    expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  it('should log message when extension is installed', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('./index');

    const firstCall = mockChrome.runtime.onInstalled.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onInstalled.addListener to be called');
    }

    const onInstalledCallback = firstCall[0];
    onInstalledCallback();

    expect(consoleSpy).toHaveBeenCalledWith('Tearleads extension installed');
    consoleSpy.mockRestore();
  });

  it('should register onMessage listener', async () => {
    await import('./index');

    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  it('should handle GET_TAB_INFO message and return tab info', async () => {
    const mockTab = { url: 'https://example.com', title: 'Example' };
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([mockTab]);
    });

    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    const result = onMessageCallback(
      { type: MessageType.GET_TAB_INFO },
      {},
      mockSendResponse
    );

    expect(result).toBe(true);
    expect(mockTabsQuery).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function)
    );
    expect(mockSendResponse).toHaveBeenCalledWith({
      url: 'https://example.com',
      title: 'Example'
    });
  });

  it('should handle GET_TAB_INFO with no tabs', async () => {
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([]);
    });

    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    onMessageCallback({ type: MessageType.GET_TAB_INFO }, {}, mockSendResponse);

    expect(mockSendResponse).toHaveBeenCalledWith({
      url: undefined,
      title: undefined
    });
  });

  it('should inject content script into the active tab', async () => {
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockScriptingExecuteScript.mockImplementation((_details, callback) => {
      withRuntimeLastError(undefined, callback);
    });

    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    const result = onMessageCallback(
      { type: MessageType.INJECT_CONTENT_SCRIPT },
      {},
      mockSendResponse
    );

    expect(result).toBe(true);
    expect(mockScriptingExecuteScript).toHaveBeenCalledWith(
      {
        target: { tabId: 123 },
        files: ['content.js']
      },
      expect.any(Function)
    );
    expect(mockSendResponse).toHaveBeenCalledWith({ status: 'injected' });
  });

  it('should fail injection when there is no active tab id', async () => {
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{}]);
    });

    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    onMessageCallback(
      { type: MessageType.INJECT_CONTENT_SCRIPT },
      {},
      mockSendResponse
    );

    expect(mockScriptingExecuteScript).not.toHaveBeenCalled();
    expect(mockSendResponse).toHaveBeenCalledWith({
      status: 'failed',
      error: 'No active tab available for script injection.'
    });
  });

  it('should fail injection when executeScript reports an error', async () => {
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 456 }]);
    });
    mockScriptingExecuteScript.mockImplementation((_details, callback) => {
      withRuntimeLastError(
        'Cannot access contents of this page.',
        callback
      );
    });

    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    onMessageCallback(
      { type: MessageType.INJECT_CONTENT_SCRIPT },
      {},
      mockSendResponse
    );

    expect(mockSendResponse).toHaveBeenCalledWith({
      status: 'failed',
      error: 'Cannot access contents of this page.'
    });
  });

  it('should return false for unknown message types', async () => {
    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    const result = onMessageCallback(
      { type: 'UNKNOWN_TYPE' },
      {},
      mockSendResponse
    );

    expect(result).toBe(false);
    expect(mockSendResponse).not.toHaveBeenCalled();
  });

  it('should return false for PING messages sent to background', async () => {
    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    const result = onMessageCallback({ type: MessageType.PING }, {}, mockSendResponse);

    expect(result).toBe(false);
    expect(mockSendResponse).not.toHaveBeenCalled();
  });

  it('should return false for non-object messages', async () => {
    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    const result = onMessageCallback(null, {}, mockSendResponse);

    expect(result).toBe(false);
    expect(mockSendResponse).not.toHaveBeenCalled();
  });
});
