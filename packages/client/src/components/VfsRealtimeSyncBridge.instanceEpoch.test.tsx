import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockGetInstanceChangeSnapshot,
  mockLogWarn,
  mockUseSSE,
  mockUseVfsOrchestratorInstance,
  resetVfsRealtimeSyncBridgeTestMocks
} from '@/components/VfsRealtimeSyncBridge.testSetup';
import { VfsRealtimeSyncBridge } from './VfsRealtimeSyncBridge';

function deferred<T>() {
  let resolveValue: ((value: T | PromiseLike<T>) => void) | null = null;
  let rejectValue: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    resolve: (value: T) => {
      if (resolveValue) {
        resolveValue(value);
      }
    },
    reject: (reason?: unknown) => {
      if (rejectValue) {
        rejectValue(reason);
      }
    }
  };
}

describe('VfsRealtimeSyncBridge instance epoch handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetVfsRealtimeSyncBridgeTestMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not schedule retries for stale-epoch sync failures', async () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    const syncGate = deferred<void>();
    const syncCrdt = vi.fn(() => syncGate.promise);
    const sseState = {
      addChannels,
      removeChannels,
      lastMessage: null as {
        channel: string;
        message: { type: string; payload: unknown; timestamp: string };
      } | null
    };

    mockUseSSE.mockImplementation(() => sseState);
    mockUseVfsOrchestratorInstance.mockReturnValue({
      crdt: {
        listChangedContainers: vi.fn(() => ({
          items: [{ containerId: 'item-1' }],
          hasMore: false,
          nextCursor: null
        }))
      },
      syncCrdt
    });

    const { rerender } = render(<VfsRealtimeSyncBridge />);
    sseState.lastMessage = {
      channel: 'vfs:container:item-1:sync',
      message: {
        type: 'vfs:cursor-bump',
        payload: {},
        timestamp: new Date().toISOString()
      }
    };
    rerender(<VfsRealtimeSyncBridge />);

    await vi.advanceTimersByTimeAsync(200);
    expect(syncCrdt).toHaveBeenCalledTimes(1);

    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId: 'instance-2',
      instanceEpoch: 2
    });
    syncGate.reject(new Error('sync failed after switch'));
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(syncCrdt).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});
