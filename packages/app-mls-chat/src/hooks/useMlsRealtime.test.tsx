import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const uploadGroupStateSnapshotMock = vi.fn();

vi.mock('./groupStateSync.js', () => ({
  uploadGroupStateSnapshot: (params: unknown) =>
    uploadGroupStateSnapshotMock(params)
}));

import type { MlsRealtimeBridge } from '../context/index.js';
import { MlsClient } from '../lib/index.js';
import { useGroupMembers } from './useGroupMembers.js';
import { createMlsHookWrapper } from './useMlsHookTestWrapper.js';
import { useMlsRealtime } from './useMlsRealtime.js';
import { useWelcomeMessages } from './useWelcomeMessages.js';

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

function emitBridgeMessage(
  bridge: MlsRealtimeBridge,
  message: { type: string; payload: unknown },
  channel = 'mls:group:group-1'
): void {
  bridge.lastMessage = {
    channel,
    message: {
      ...message,
      timestamp: '2026-03-03T06:10:00.000Z'
    }
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__mlsMessageHandler');
  Reflect.deleteProperty(globalThis, '__mlsMembershipHandler');
  Reflect.deleteProperty(globalThis, '__mlsWelcomeRefreshHandler');
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useMlsRealtime', () => {
  it('dispatches application messages to registered handlers', async () => {
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

    act(() => {
      emitBridgeMessage(bridge, {
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
        }
      });
    });

    rerender();

    await waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    unmount();
    client.close();
  });

  it('processes commit messages from other senders and uploads state snapshots', async () => {
    uploadGroupStateSnapshotMock.mockResolvedValue(undefined);

    const { bridge } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');
    const hasGroupSpy = vi.spyOn(client, 'hasGroup').mockReturnValue(true);
    const processCommitSpy = vi
      .spyOn(client, 'processCommit')
      .mockResolvedValue(undefined);

    const { result, rerender, unmount } = renderHook(
      () => useMlsRealtime(client),
      {
        wrapper: createMlsHookWrapper(undefined, bridge)
      }
    );

    act(() => {
      result.current.subscribe('group-1');
    });

    act(() => {
      emitBridgeMessage(bridge, {
        type: 'mls:message',
        payload: {
          id: 'commit-1',
          groupId: 'group-1',
          senderUserId: 'other-user',
          epoch: 5,
          ciphertext: commitCiphertext([10, 11, 12]),
          messageType: 'commit',
          contentType: 'application/mls-commit',
          sequenceNumber: 8,
          sentAt: '2026-03-03T06:15:00.000Z',
          createdAt: '2026-03-03T06:15:00.000Z'
        }
      });
    });

    rerender();

    await waitFor(() => {
      expect(processCommitSpy).toHaveBeenCalledTimes(1);
    });

    expect(hasGroupSpy).toHaveBeenCalledWith('group-1');
    expect(processCommitSpy).toHaveBeenCalledWith(
      'group-1',
      Uint8Array.from([10, 11, 12])
    );

    await waitFor(() => {
      expect(uploadGroupStateSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group-1',
          client
        })
      );
    });

    unmount();
    client.close();
  });

  it('skips invalid commit ciphertext payloads', async () => {
    const { bridge } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');
    vi.spyOn(client, 'hasGroup').mockReturnValue(true);
    const processCommitSpy = vi
      .spyOn(client, 'processCommit')
      .mockResolvedValue(undefined);

    const { result, rerender, unmount } = renderHook(
      () => useMlsRealtime(client),
      {
        wrapper: createMlsHookWrapper(undefined, bridge)
      }
    );

    act(() => {
      result.current.subscribe('group-1');
    });

    act(() => {
      emitBridgeMessage(bridge, {
        type: 'mls:message',
        payload: {
          id: 'commit-invalid',
          groupId: 'group-1',
          senderUserId: 'other-user',
          epoch: 5,
          ciphertext: 'not-base64***',
          messageType: 'commit',
          contentType: 'application/mls-commit',
          sequenceNumber: 9,
          sentAt: '2026-03-03T06:18:00.000Z',
          createdAt: '2026-03-03T06:18:00.000Z'
        }
      });
    });

    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(processCommitSpy).not.toHaveBeenCalled();
    expect(uploadGroupStateSnapshotMock).not.toHaveBeenCalled();

    unmount();
    client.close();
  });

  it('ignores commit messages emitted by the current user', async () => {
    const { bridge } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');
    vi.spyOn(client, 'hasGroup').mockReturnValue(true);
    const processCommitSpy = vi
      .spyOn(client, 'processCommit')
      .mockResolvedValue(undefined);

    const { result, rerender, unmount } = renderHook(
      () => useMlsRealtime(client),
      {
        wrapper: createMlsHookWrapper(undefined, bridge)
      }
    );

    act(() => {
      result.current.subscribe('group-1');
    });

    act(() => {
      emitBridgeMessage(bridge, {
        type: 'mls:message',
        payload: {
          id: 'commit-2',
          groupId: 'group-1',
          senderUserId: 'test-user-id',
          epoch: 5,
          ciphertext: commitCiphertext([20, 21, 22]),
          messageType: 'commit',
          contentType: 'application/mls-commit',
          sequenceNumber: 10,
          sentAt: '2026-03-03T06:20:00.000Z',
          createdAt: '2026-03-03T06:20:00.000Z'
        }
      });
    });

    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(processCommitSpy).not.toHaveBeenCalled();
    expect(uploadGroupStateSnapshotMock).not.toHaveBeenCalled();

    unmount();
    client.close();
  });

  it('skips commit processing when local group state is missing', async () => {
    const { bridge } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');
    vi.spyOn(client, 'hasGroup').mockReturnValue(false);
    const processCommitSpy = vi
      .spyOn(client, 'processCommit')
      .mockResolvedValue(undefined);

    const { result, rerender, unmount } = renderHook(
      () => useMlsRealtime(client),
      {
        wrapper: createMlsHookWrapper(undefined, bridge)
      }
    );

    act(() => {
      result.current.subscribe('group-1');
    });

    act(() => {
      emitBridgeMessage(bridge, {
        type: 'mls:message',
        payload: {
          id: 'commit-3',
          groupId: 'group-1',
          senderUserId: 'other-user',
          epoch: 5,
          ciphertext: commitCiphertext([30, 31, 32]),
          messageType: 'commit',
          contentType: 'application/mls-commit',
          sequenceNumber: 11,
          sentAt: '2026-03-03T06:22:00.000Z',
          createdAt: '2026-03-03T06:22:00.000Z'
        }
      });
    });

    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(processCommitSpy).not.toHaveBeenCalled();
    expect(uploadGroupStateSnapshotMock).not.toHaveBeenCalled();

    unmount();
    client.close();
  });

  it('forwards membership and welcome events to registered refresh handlers', async () => {
    const membershipRefresh = vi.fn();
    const welcomeRefresh = vi.fn();

    Reflect.set(
      globalThis,
      '__mlsMembershipHandler',
      new Map<string, () => void>([['group-1', membershipRefresh]])
    );
    Reflect.set(globalThis, '__mlsWelcomeRefreshHandler', welcomeRefresh);

    const { bridge } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');
    const { rerender } = renderHook(() => useMlsRealtime(client), {
      wrapper: createMlsHookWrapper(undefined, bridge)
    });

    act(() => {
      emitBridgeMessage(
        bridge,
        {
          type: 'mls:member_added',
          payload: { groupId: 'group-1', userId: 'other-user' }
        },
        'mls:group:group-1'
      );
    });
    rerender();

    await waitFor(() => {
      expect(membershipRefresh).toHaveBeenCalledTimes(1);
    });

    act(() => {
      emitBridgeMessage(
        bridge,
        {
          type: 'mls:welcome',
          payload: { groupId: 'group-1', welcomeId: 'welcome-1' }
        },
        'mls:user:test-user-id'
      );
    });
    rerender();

    await waitFor(() => {
      expect(welcomeRefresh).toHaveBeenCalledTimes(1);
    });

    client.close();
  });
});

describe('MLS hook refresh registration', () => {
  it('refreshes group members when membership realtime handler runs', async () => {
    const getGroupMembersMock = vi.fn().mockResolvedValue({ members: [] });

    const client = new MlsClient('test-user-id');
    renderHook(() => useGroupMembers('group-1', client), {
      wrapper: createMlsHookWrapper({ getGroupMembers: getGroupMembersMock })
    });

    await waitFor(() => {
      expect(getGroupMembersMock).toHaveBeenCalledTimes(1);
    });

    const handlerRegistry = Reflect.get(globalThis, '__mlsMembershipHandler');
    expect(handlerRegistry).toBeInstanceOf(Map);
    if (!(handlerRegistry instanceof Map)) {
      throw new Error('missing membership handler registry');
    }

    const groupHandlers = handlerRegistry.get('group-1');
    expect(groupHandlers).toBeInstanceOf(Set);
    if (!(groupHandlers instanceof Set)) {
      throw new Error('missing membership refresh handler set');
    }

    const refreshHandler = Array.from(groupHandlers)[0];
    expect(typeof refreshHandler).toBe('function');
    if (typeof refreshHandler !== 'function') {
      throw new Error('missing membership refresh handler');
    }

    await act(async () => {
      refreshHandler();
    });

    await waitFor(() => {
      expect(getGroupMembersMock).toHaveBeenCalledTimes(2);
    });

    client.close();
  });

  it('refreshes welcome messages when welcome realtime handler runs', async () => {
    const getWelcomeMessagesMock = vi.fn().mockResolvedValue({ welcomes: [] });

    const client = new MlsClient('test-user-id');
    renderHook(() => useWelcomeMessages(client), {
      wrapper: createMlsHookWrapper({
        getWelcomeMessages: getWelcomeMessagesMock
      })
    });

    await waitFor(() => {
      expect(getWelcomeMessagesMock).toHaveBeenCalledTimes(1);
    });

    const refreshHandlers = Reflect.get(
      globalThis,
      '__mlsWelcomeRefreshHandler'
    );
    expect(refreshHandlers).toBeInstanceOf(Set);
    if (!(refreshHandlers instanceof Set)) {
      throw new Error('missing welcome refresh handler set');
    }

    const refreshHandler = Array.from(refreshHandlers)[0];
    expect(typeof refreshHandler).toBe('function');
    if (typeof refreshHandler !== 'function') {
      throw new Error('missing welcome refresh handler');
    }

    await act(async () => {
      refreshHandler();
    });

    await waitFor(() => {
      expect(getWelcomeMessagesMock).toHaveBeenCalledTimes(2);
    });

    client.close();
  });
});
