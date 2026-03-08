import { describe, expect, it, vi } from 'vitest';
import {
  createNotificationStreamManager,
  type NotificationStreamManager
} from './notificationStreamManager';

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('notificationStreamManager', () => {
  it('emits connected state and forwards message payloads', async () => {
    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ event: 'connected' });
        yield JSON.stringify({
          event: 'message',
          channel: 'broadcast',
          message: {
            type: 'test',
            payload: { ok: true },
            timestamp: '2026-03-07T00:00:00.000Z'
          }
        });
        throw createAbortError();
      }
    }));

    const manager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => false,
      tryRefreshToken: vi.fn()
    });

    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      token: 'token'
    });

    await vi.waitFor(() => {
      expect(manager.getSnapshot().lastMessage).not.toBeNull();
    });

    expect(listener).toHaveBeenCalled();
    expect(manager.getSnapshot()).toEqual({
      connectionState: 'connected',
      lastMessage: {
        channel: 'broadcast',
        message: {
          type: 'test',
          payload: { ok: true },
          timestamp: '2026-03-07T00:00:00.000Z'
        }
      }
    });
    expect(openNotificationEventStream).toHaveBeenCalledTimes(1);

    unsubscribe();
    manager.disconnect();
  });

  it('treats a message event as connected even without handshake', async () => {
    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({
          event: 'message',
          channel: 'broadcast',
          message: {
            type: 'test',
            payload: { ok: true },
            timestamp: '2026-03-07T00:00:00.000Z'
          }
        });
        throw createAbortError();
      }
    }));

    const manager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => false,
      tryRefreshToken: vi.fn()
    });

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      token: 'token'
    });

    await vi.waitFor(() => {
      expect(manager.getSnapshot().lastMessage).not.toBeNull();
    });

    expect(manager.getSnapshot().connectionState).toBe('connected');
    manager.disconnect();
  });

  it('clears the last message when disconnected', async () => {
    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ event: 'connected' });
        yield JSON.stringify({
          event: 'message',
          channel: 'broadcast',
          message: {
            type: 'test',
            payload: { ok: true },
            timestamp: '2026-03-07T00:00:00.000Z'
          }
        });
        await new Promise(() => {
          // wait until manager disconnects
        });
      }
    }));

    const manager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => false,
      tryRefreshToken: vi.fn()
    });

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      token: 'token'
    });

    await vi.waitFor(() => {
      expect(manager.getSnapshot().lastMessage).not.toBeNull();
    });

    manager.disconnect();

    expect(manager.getSnapshot()).toEqual({
      connectionState: 'disconnected',
      lastMessage: null
    });
  });

  it('aborts the active stream when disconnected', async () => {
    let observedSignal: AbortSignal | null = null;

    const openNotificationEventStream = vi
      .fn()
      .mockImplementation((options: { signal?: AbortSignal }) => {
        observedSignal = options.signal ?? null;
        return {
          async *[Symbol.asyncIterator]() {
            await new Promise(() => {
              // wait until manager aborts
            });
          }
        };
      });

    const manager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => false,
      tryRefreshToken: vi.fn()
    });

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      token: 'token'
    });

    await flushMicrotasks();
    expect(observedSignal).not.toBeNull();
    expect(observedSignal?.aborted).toBe(false);

    manager.disconnect();

    expect(observedSignal?.aborted).toBe(true);
    expect(manager.getSnapshot().connectionState).toBe('disconnected');
  });

  it('attempts token refresh when stream ends with expired token', async () => {
    const tryRefreshToken = vi.fn();
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ event: 'connected' });
      }
    }));

    const manager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => true,
      tryRefreshToken
    });

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      token: 'expired-token'
    });

    await flushMicrotasks();

    expect(tryRefreshToken).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().connectionState).toBe('connecting');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[notification-stream-manager]',
      expect.objectContaining({
        event: 'reconnect-deferred-token-refresh',
        reason: 'stream-ended'
      })
    );
    manager.disconnect();
    consoleSpy.mockRestore();
  });

  it('skips reconnect when connect is called with equivalent config', async () => {
    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        await new Promise(() => {
          // wait until manager disconnects
        });
      }
    }));

    const manager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => false,
      tryRefreshToken: vi.fn()
    });

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast', 'mls:user:test', 'broadcast'],
      token: 'token'
    });
    await flushMicrotasks();

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['mls:user:test', 'broadcast'],
      token: 'token'
    });
    await flushMicrotasks();

    expect(openNotificationEventStream).toHaveBeenCalledTimes(1);
    manager.disconnect();
  });

  it('reconnects only when effective additional channels change', async () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        await new Promise(() => {
          // wait until manager reconnects or disconnects
        });
      }
    }));

    const manager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => false,
      tryRefreshToken: vi.fn()
    });

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      token: 'token'
    });
    await flushMicrotasks();

    manager.addChannels(['mls:user:test']);
    await flushMicrotasks();
    manager.addChannels(['mls:user:test']);
    await flushMicrotasks();

    manager.removeChannels(['mls:user:test']);
    await flushMicrotasks();
    manager.removeChannels(['mls:user:test']);
    await flushMicrotasks();

    expect(openNotificationEventStream).toHaveBeenCalledTimes(3);
    expect(openNotificationEventStream.mock.calls[0]?.[0]?.channels).toEqual([
      'broadcast'
    ]);
    expect(openNotificationEventStream.mock.calls[1]?.[0]?.channels).toEqual([
      'broadcast',
      'mls:user:test'
    ]);
    expect(openNotificationEventStream.mock.calls[2]?.[0]?.channels).toEqual([
      'broadcast'
    ]);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[notification-stream-manager]',
      expect.objectContaining({
        event: 'channel-set-changed',
        reason: 'channel-registration-add',
        addedChannels: ['mls:user:test'],
        removedChannels: []
      })
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '[notification-stream-manager]',
      expect.objectContaining({
        event: 'channel-set-changed',
        reason: 'channel-registration-remove',
        addedChannels: [],
        removedChannels: ['mls:user:test']
      })
    );
    manager.disconnect();
    consoleSpy.mockRestore();
  });

  it('reconnects with scheduled delay when stream ends and token is valid', async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ event: 'connected' });
      }
    }));

    const manager: NotificationStreamManager = createNotificationStreamManager({
      openNotificationEventStream,
      isTokenExpired: () => false,
      tryRefreshToken: vi.fn(),
      computeReconnectDelayWithJitter: () => 25
    });

    manager.connect({
      apiBaseUrl: 'http://localhost:5001/v1',
      channels: ['broadcast'],
      token: 'token'
    });

    await flushMicrotasks();
    expect(openNotificationEventStream).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[notification-stream-manager]',
      expect.objectContaining({
        event: 'reconnect-scheduled',
        reason: 'stream-ended',
        attempt: 1,
        delayMs: 25
      })
    );

    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();

    expect(openNotificationEventStream).toHaveBeenCalledTimes(2);

    manager.disconnect();
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });
});
