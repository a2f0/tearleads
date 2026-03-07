import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { openNotificationEventStreamMock } = vi.hoisted(() => ({
  openNotificationEventStreamMock: vi.fn()
}));

vi.mock('@tearleads/api-client/notificationStream', () => ({
  openNotificationEventStream: (...args: unknown[]) =>
    openNotificationEventStreamMock(...args)
}));

import type { MlsRealtimeBridge } from '../context/index.js';
import { MlsClient } from '../lib/index.js';
import { createMlsHookWrapper } from './useMlsHookTestWrapper.js';
import { useMlsRealtime } from './useMlsRealtime.js';

function createSharedRealtimeBridge(): {
  bridge: MlsRealtimeBridge;
  addChannels: ReturnType<typeof vi.fn>;
  removeChannels: ReturnType<typeof vi.fn>;
} {
  const addChannels = vi.fn();
  const removeChannels = vi.fn();

  const bridge: MlsRealtimeBridge = {
    connectionState: 'connected',
    lastMessage: null,
    addChannels,
    removeChannels
  };

  return {
    bridge,
    addChannels,
    removeChannels
  };
}

function commitCiphertext(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__mlsMessageHandler');
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useMlsRealtime shared realtime bridge', () => {
  it('registers channels through the shared bridge without opening a direct stream', async () => {
    const { bridge, addChannels, removeChannels } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');

    const { result, unmount } = renderHook(() => useMlsRealtime(client), {
      wrapper: createMlsHookWrapper(undefined, bridge)
    });

    await waitFor(() => {
      expect(addChannels).toHaveBeenCalledWith(['mls:user:test-user-id']);
    });

    act(() => {
      result.current.subscribe('group-1');
    });

    await waitFor(() => {
      expect(addChannels).toHaveBeenCalledWith([
        'mls:user:test-user-id',
        'mls:group:group-1'
      ]);
    });

    expect(openNotificationEventStreamMock).not.toHaveBeenCalled();

    unmount();

    expect(removeChannels).toHaveBeenCalled();
    client.close();
  });

  it('dispatches shared bridge application messages to registered handlers', async () => {
    const handler = vi.fn();
    Reflect.set(
      globalThis,
      '__mlsMessageHandler',
      new Map<string, (msg: unknown) => void>([['group-1', handler]])
    );

    const { bridge } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');

    const { result, rerender, unmount } = renderHook(
      () => useMlsRealtime(client),
      {
        wrapper: createMlsHookWrapper(undefined, bridge)
      }
    );

    act(() => {
      result.current.subscribe('group-1');
    });

    bridge.lastMessage = {
      channel: 'mls:group:group-1',
      message: {
        type: 'mls:message',
        payload: {
          id: 'msg-1',
          groupId: 'group-1',
          senderUserId: 'other-user',
          epoch: 2,
          ciphertext: commitCiphertext([1, 2, 3]),
          messageType: 'application',
          contentType: 'text/plain',
          sequenceNumber: 4,
          sentAt: '2026-03-03T06:10:00.000Z',
          createdAt: '2026-03-03T06:10:00.000Z'
        },
        timestamp: '2026-03-03T06:10:00.000Z'
      }
    };

    rerender();

    await waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    expect(openNotificationEventStreamMock).not.toHaveBeenCalled();

    unmount();
    client.close();
  });
});
