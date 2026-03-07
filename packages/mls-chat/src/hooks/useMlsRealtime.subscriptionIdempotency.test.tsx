import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MlsClient } from '../lib/index.js';
import { createMlsHookWrapper } from './useMlsHookTestWrapper.js';
import { useMlsRealtime } from './useMlsRealtime.js';

const { openNotificationEventStreamMock } = vi.hoisted(() => ({
  openNotificationEventStreamMock: vi.fn()
}));

vi.mock('@tearleads/api-client/notificationStream', () => ({
  openNotificationEventStream: (...args: unknown[]) =>
    openNotificationEventStreamMock(...args)
}));

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function streamFromEnvelopes(envelopes: unknown[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const envelope of envelopes) {
        yield JSON.stringify(envelope);
      }
      throw createAbortError();
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useMlsRealtime subscribe idempotency', () => {
  it('does not reconnect when subscribing to an already-subscribed group', async () => {
    openNotificationEventStreamMock.mockImplementation(() =>
      streamFromEnvelopes([{ event: 'connected' }])
    );

    const client = new MlsClient('test-user-id');
    const { result, unmount } = renderHook(() => useMlsRealtime(client), {
      wrapper: createMlsHookWrapper()
    });

    await waitFor(() => {
      expect(openNotificationEventStreamMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.subscribe('group-1');
    });

    await waitFor(() => {
      expect(openNotificationEventStreamMock).toHaveBeenCalledTimes(2);
    });

    act(() => {
      result.current.subscribe('group-1');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(openNotificationEventStreamMock).toHaveBeenCalledTimes(2);

    unmount();
    client.close();
  });
});
