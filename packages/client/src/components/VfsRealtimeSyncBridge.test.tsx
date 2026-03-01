import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsRealtimeSyncBridge } from './VfsRealtimeSyncBridge';

const mockUseSSE = vi.fn();
const mockUseVfsOrchestratorInstance = vi.fn();
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();

vi.mock('@/sse', () => ({
  useSSE: () => mockUseSSE()
}));

vi.mock('@/contexts/VfsOrchestratorContext', () => ({
  useVfsOrchestratorInstance: () => mockUseVfsOrchestratorInstance()
}));

vi.mock('@/stores/logStore', () => ({
  logStore: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args)
  }
}));

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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects with broadcast channel when no orchestrator is available', () => {
    const connect = vi.fn();
    mockUseSSE.mockReturnValue({
      connect,
      lastMessage: null
    });
    mockUseVfsOrchestratorInstance.mockReturnValue(null);

    render(<VfsRealtimeSyncBridge />);

    expect(connect).toHaveBeenCalledWith(['broadcast']);
  });

  it('connects with derived container channels from known clocks', () => {
    const connect = vi.fn();
    mockUseSSE.mockReturnValue({
      connect,
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

    expect(connect).toHaveBeenCalledWith([
      'broadcast',
      'vfs:container:a:sync',
      'vfs:container:z:sync'
    ]);
  });

  it('does not reconnect when computed channels have not changed', async () => {
    const connect = vi.fn();
    mockUseSSE.mockReturnValue({
      connect,
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
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('triggers debounced sync on VFS cursor-bump messages', async () => {
    const connect = vi.fn();
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
    const sseState = {
      connect,
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
    expect(mockLogInfo).toHaveBeenCalledWith(
      'VFS SSE cursor bump received; triggering CRDT sync',
      expect.stringContaining('channel=vfs:container:item-1:sync')
    );
  });

  it('ignores non-VFS or non-cursor-bump messages', async () => {
    const connect = vi.fn();
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
    const sseState = {
      connect,
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
    const connect = vi.fn();
    const syncGate = deferred<void>();
    const syncCrdt = vi.fn(() => syncGate.promise);
    const sseState = {
      connect,
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
    const connect = vi.fn();
    const syncCrdt = vi
      .fn()
      .mockRejectedValueOnce(new Error('sync failed'))
      .mockResolvedValue(undefined);
    const sseState = {
      connect,
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
    expect(mockLogWarn).toHaveBeenCalledWith(
      'VFS CRDT sync failed after SSE trigger; scheduling retry',
      expect.stringContaining('attempt=1')
    );
    randomSpy.mockRestore();
  });

  it('clears pending retry timer on unmount', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const connect = vi.fn();
    const syncCrdt = vi.fn().mockRejectedValue(new Error('sync failed'));
    const sseState = {
      connect,
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
