import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockBlobDownloadSyncRun,
  mockHydrateLocalReadModelFromRemoteFeeds,
  mockLogInfo,
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

describe('VfsRealtimeSyncBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetVfsRealtimeSyncBridgeTestMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers no dynamic channels when no orchestrator is available', () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    mockUseSSE.mockReturnValue({
      addChannels,
      removeChannels,
      lastMessage: null
    });
    mockUseVfsOrchestratorInstance.mockReturnValue(null);

    render(<VfsRealtimeSyncBridge />);

    expect(addChannels).not.toHaveBeenCalled();
  });

  it('registers derived container channels from known clocks', () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    mockUseSSE.mockReturnValue({
      addChannels,
      removeChannels,
      lastMessage: null
    });
    mockUseVfsOrchestratorInstance.mockReturnValue({
      crdt: {
        listChangedContainers: vi.fn(() => ({
          items: [{ containerId: 'z' }, { containerId: 'a' }],
          hasMore: false,
          nextCursor: null
        }))
      },
      syncCrdt: vi.fn()
    });

    render(<VfsRealtimeSyncBridge />);

    expect(addChannels).toHaveBeenCalledWith([
      'vfs:container:a:sync',
      'vfs:container:z:sync'
    ]);
  });

  it('does not re-register when computed channels have not changed', async () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    mockUseSSE.mockReturnValue({
      addChannels,
      removeChannels,
      lastMessage: null
    });
    mockUseVfsOrchestratorInstance.mockReturnValue({
      crdt: {
        listChangedContainers: vi.fn(() => ({
          items: [{ containerId: 'item-1' }],
          hasMore: false,
          nextCursor: null
        }))
      },
      syncCrdt: vi.fn()
    });

    render(<VfsRealtimeSyncBridge />);
    expect(addChannels).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(addChannels).toHaveBeenCalledTimes(1);
  });

  it('triggers a sync when the orchestrator swaps through a null transition', async () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    const syncCrdtAlice = vi.fn().mockResolvedValue(undefined);
    const syncCrdtBob = vi.fn().mockResolvedValue(undefined);
    const sseState = {
      addChannels,
      removeChannels,
      lastMessage: null as {
        channel: string;
        message: { type: string; payload: unknown; timestamp: string };
      } | null
    };
    const orchestratorState: {
      current: {
        crdt: {
          listChangedContainers: ReturnType<typeof vi.fn>;
        };
        syncCrdt: ReturnType<typeof vi.fn>;
      } | null;
    } = {
      current: {
        crdt: {
          listChangedContainers: vi.fn(() => ({
            items: [{ containerId: 'item-1' }],
            hasMore: false,
            nextCursor: null
          }))
        },
        syncCrdt: syncCrdtAlice
      }
    };

    mockUseSSE.mockImplementation(() => sseState);
    mockUseVfsOrchestratorInstance.mockImplementation(
      () => orchestratorState.current
    );

    const { rerender } = render(<VfsRealtimeSyncBridge />);
    await vi.advanceTimersByTimeAsync(200);

    // Initial mount does not force an unconditional sync.
    expect(syncCrdtAlice).not.toHaveBeenCalled();

    orchestratorState.current = null;
    rerender(<VfsRealtimeSyncBridge />);
    await vi.advanceTimersByTimeAsync(50);

    orchestratorState.current = {
      crdt: {
        listChangedContainers: vi.fn(() => ({
          items: [{ containerId: 'item-1' }],
          hasMore: false,
          nextCursor: null
        }))
      },
      syncCrdt: syncCrdtBob
    };
    rerender(<VfsRealtimeSyncBridge />);

    await vi.advanceTimersByTimeAsync(200);

    expect(syncCrdtBob).toHaveBeenCalledTimes(1);
    expect(mockHydrateLocalReadModelFromRemoteFeeds).toHaveBeenCalledTimes(1);
  });

  it('triggers debounced sync on VFS cursor-bump messages', async () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
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
    expect(mockHydrateLocalReadModelFromRemoteFeeds).toHaveBeenCalledTimes(1);
  });

  it('runs blob download sync after CRDT sync completes', async () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
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

    await vi.advanceTimersByTimeAsync(700);

    expect(syncCrdt).toHaveBeenCalledTimes(1);
    expect(mockHydrateLocalReadModelFromRemoteFeeds).toHaveBeenCalledTimes(1);
    expect(mockBlobDownloadSyncRun).toHaveBeenCalledTimes(1);
  });

  it('ignores non-VFS or non-cursor-bump messages', async () => {
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
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
      channel: 'broadcast',
      message: {
        type: 'vfs:cursor-bump',
        payload: {},
        timestamp: new Date().toISOString()
      }
    };
    rerender(<VfsRealtimeSyncBridge />);

    sseState.lastMessage = {
      channel: 'vfs:container:item-1:sync',
      message: {
        type: 'something-else',
        payload: {},
        timestamp: new Date().toISOString()
      }
    };
    rerender(<VfsRealtimeSyncBridge />);

    await vi.advanceTimersByTimeAsync(250);
    expect(syncCrdt).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it('coalesces cursor-bump syncs while a sync is in flight', async () => {
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

    syncGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

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
    expect(syncCrdt).toHaveBeenCalledTimes(2);
  });

  it('retries failed sync with backoff and re-enters debounced path', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    const syncCrdt = vi
      .fn()
      .mockRejectedValueOnce(new Error('sync failed'))
      .mockResolvedValue(undefined);
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

    await vi.advanceTimersByTimeAsync(999);
    expect(syncCrdt).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(syncCrdt).toHaveBeenCalledTimes(2);
    randomSpy.mockRestore();
  });

  it('clears pending retry timer on unmount', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const addChannels = vi.fn();
    const removeChannels = vi.fn();
    const syncCrdt = vi.fn().mockRejectedValue(new Error('sync failed'));
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

    const { rerender, unmount } = render(<VfsRealtimeSyncBridge />);
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

    unmount();
    await vi.advanceTimersByTimeAsync(2000);
    expect(syncCrdt).toHaveBeenCalledTimes(1);
    randomSpy.mockRestore();
  });
});
