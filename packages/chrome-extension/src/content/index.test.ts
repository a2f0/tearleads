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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register onMessage listener', async () => {
    await import('./index');

    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  it('should respond to PING message with ok status', async () => {
    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall)
      throw new Error('Expected onMessage.addListener to be called');
    const onMessageCallback = firstCall[0];
    onMessageCallback({ type: MessageType.PING }, {}, mockSendResponse);

    expect(mockSendResponse).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('should not respond to unknown message types', async () => {
    await import('./index');

    const firstCall = mockChrome.runtime.onMessage.addListener.mock.calls[0];
    if (!firstCall)
      throw new Error('Expected onMessage.addListener to be called');
    const onMessageCallback = firstCall[0];
    onMessageCallback({ type: 'UNKNOWN_TYPE' }, {}, mockSendResponse);

    expect(mockSendResponse).not.toHaveBeenCalled();
  });
});
