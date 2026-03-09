import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('useMlsRealtime subscribe idempotency', () => {
  it('does not re-register channels when subscribing to an already-subscribed group', async () => {
    const { bridge, addChannels } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');
    const { result, unmount } = renderHook(() => useMlsRealtime(client), {
      wrapper: createMlsHookWrapper(undefined, bridge)
    });

    await waitFor(() => {
      expect(addChannels).toHaveBeenCalledTimes(1);
    });
    expect(addChannels).toHaveBeenLastCalledWith(['mls:user:test-user-id']);

    act(() => {
      result.current.subscribe('group-1');
    });

    await waitFor(() => {
      expect(addChannels).toHaveBeenCalledTimes(2);
    });
    expect(addChannels).toHaveBeenLastCalledWith([
      'mls:user:test-user-id',
      'mls:group:group-1'
    ]);

    act(() => {
      result.current.subscribe('group-1');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(addChannels).toHaveBeenCalledTimes(2);

    unmount();
    client.close();
  });

  it('does not re-register channels when unsubscribing from a non-subscribed group', async () => {
    const { bridge, addChannels } = createSharedRealtimeBridge();
    const client = new MlsClient('test-user-id');
    const { result, unmount } = renderHook(() => useMlsRealtime(client), {
      wrapper: createMlsHookWrapper(undefined, bridge)
    });

    await waitFor(() => {
      expect(addChannels).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.subscribe('group-1');
    });

    await waitFor(() => {
      expect(addChannels).toHaveBeenCalledTimes(2);
    });

    act(() => {
      result.current.unsubscribe('group-missing');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(addChannels).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.unsubscribe('group-1');
    });

    await waitFor(() => {
      expect(addChannels).toHaveBeenCalledTimes(3);
    });
    expect(addChannels).toHaveBeenLastCalledWith(['mls:user:test-user-id']);

    act(() => {
      result.current.unsubscribe('group-1');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(addChannels).toHaveBeenCalledTimes(3);

    unmount();
    client.close();
  });
});
