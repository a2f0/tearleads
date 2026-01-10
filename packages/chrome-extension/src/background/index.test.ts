import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../messages';

const mockSendResponse = vi.fn();
const mockTabsQuery = vi.fn();

const mockChrome = {
  runtime: {
    onInstalled: {
      addListener: vi.fn()
    },
    onMessage: {
      addListener: vi.fn()
    }
  },
  tabs: {
    query: mockTabsQuery
  }
};

vi.stubGlobal('chrome', mockChrome);

describe('background script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
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

    const onInstalledCallback =
      mockChrome.runtime.onInstalled.addListener.mock.calls[0][0];
    onInstalledCallback();

    expect(consoleSpy).toHaveBeenCalledWith('Rapid extension installed');
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

    const onMessageCallback =
      mockChrome.runtime.onMessage.addListener.mock.calls[0][0];
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

    const onMessageCallback =
      mockChrome.runtime.onMessage.addListener.mock.calls[0][0];
    onMessageCallback({ type: MessageType.GET_TAB_INFO }, {}, mockSendResponse);

    expect(mockSendResponse).toHaveBeenCalledWith({
      url: undefined,
      title: undefined
    });
  });

  it('should return false for unknown message types', async () => {
    await import('./index');

    const onMessageCallback =
      mockChrome.runtime.onMessage.addListener.mock.calls[0][0];
    const result = onMessageCallback(
      { type: 'UNKNOWN_TYPE' },
      {},
      mockSendResponse
    );

    expect(result).toBe(false);
    expect(mockSendResponse).not.toHaveBeenCalled();
  });
});
