import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../messages';

const mockSendResponse = vi.fn();

const mockChrome = {
  runtime: {
    onMessage: {
      addListener: vi.fn()
    }
  }
};

vi.stubGlobal('chrome', mockChrome);

describe('content script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    globalThis.__tearleadsContentScriptInitialized = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.__tearleadsContentScriptInitialized = undefined;
  });

  it('should register onMessage listener when not initialized', async () => {
    await import('./index');

    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  it('should not register listener when content script is already initialized', async () => {
    globalThis.__tearleadsContentScriptInitialized = true;

    await import('./index');

    expect(mockChrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
  });

  it('should respond to PING message with ok status', async () => {
    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onMessage.addListener to be called');
    }

    const onMessageCallback = firstCall[0];
    const result = onMessageCallback(
      { type: MessageType.PING },
      {},
      mockSendResponse
    );

    expect(result).toBe(true);
    expect(mockSendResponse).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('should not respond to unknown message types', async () => {
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

  it('should not respond to malformed messages', async () => {
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
