import { stringifyJsonWithByteArrays } from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import { createNotificationStreamManager } from './notificationStreamManager';

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  const timeoutMs = 2_000;
  const intervalMs = 10;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

describe('notificationStreamManager byte array payloads', () => {
  it('revives Uint8Array payload fields from streamed JSON', async () => {
    const openNotificationEventStream = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield stringifyJsonWithByteArrays({ event: 'connected' });
        yield stringifyJsonWithByteArrays({
          event: 'message',
          channel: 'mls:group:group-1',
          message: {
            type: 'mls:message',
            payload: {
              ciphertext: Uint8Array.from([1, 2, 3])
            },
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
      channels: ['mls:group:group-1'],
      token: 'token'
    });

    await waitForAssertion(() => {
      expect(manager.getSnapshot().lastMessage).not.toBeNull();
    });

    expect(manager.getSnapshot().lastMessage).toEqual({
      channel: 'mls:group:group-1',
      message: {
        type: 'mls:message',
        payload: {
          ciphertext: Uint8Array.from([1, 2, 3])
        },
        timestamp: '2026-03-07T00:00:00.000Z'
      }
    });

    manager.disconnect();
  });
});
