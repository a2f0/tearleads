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
    manager.disconnect();
  });

  it('reconnects with scheduled delay when stream ends and token is valid', async () => {
    vi.useFakeTimers();

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

    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();

    expect(openNotificationEventStream).toHaveBeenCalledTimes(2);

    manager.disconnect();
    vi.useRealTimers();
  });
});
