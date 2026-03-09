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

let contentModulePromise: Promise<typeof import('./index')> | undefined;

async function loadContentScriptModule() {
  contentModulePromise ??= import('./index');
  const module = await contentModulePromise;
  vi.clearAllMocks();
  return module;
}

describe('content script', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', mockChrome);
    vi.clearAllMocks();
    globalThis.__tearleadsContentScriptInitialized = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.__tearleadsContentScriptInitialized = undefined;
  });

  it('should register onMessage listener when not initialized', async () => {
    const module = await loadContentScriptModule();
    globalThis.__tearleadsContentScriptInitialized = undefined;
    module.initializeContentScript();

    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  it('should not register listener when content script is already initialized', async () => {
    const module = await loadContentScriptModule();
    globalThis.__tearleadsContentScriptInitialized = true;
    module.initializeContentScript();

    expect(mockChrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
  });

  it('should respond to PING message with ok status', async () => {
    const module = await loadContentScriptModule();
    globalThis.__tearleadsContentScriptInitialized = undefined;
    module.initializeContentScript();

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
    const module = await loadContentScriptModule();
    globalThis.__tearleadsContentScriptInitialized = undefined;
    module.initializeContentScript();

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
    const module = await loadContentScriptModule();
    globalThis.__tearleadsContentScriptInitialized = undefined;
    module.initializeContentScript();

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
