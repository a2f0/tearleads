import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMlsState, useMLS } from './useMLS';

// Default message handler for tests - can be overridden per test
let globalMessageHandler: ((data: unknown) => unknown) | null = null;

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;
  private messageHandler: ((data: unknown) => unknown) | null = null;

  constructor(_url: URL, _options?: WorkerOptions) {
    MockWorker.instance = this;
    // Apply any pre-configured global handler
    if (globalMessageHandler) {
      this.messageHandler = globalMessageHandler;
    }
  }

  postMessage(data: unknown) {
    if (this.messageHandler) {
      const response = this.messageHandler(data);
      if (this.onmessage && response) {
        this.onmessage(new MessageEvent('message', { data: response }));
      }
    }
  }

  setMessageHandler(handler: (data: unknown) => unknown) {
    this.messageHandler = handler;
  }

  terminate() {}

  static instance: MockWorker | null = null;
}

vi.stubGlobal('Worker', MockWorker);

// Helper to set up message handler before worker is created
function setGlobalMessageHandler(handler: (data: unknown) => unknown) {
  globalMessageHandler = handler;
}

describe('useMLS', () => {
  beforeEach(() => {
    resetMlsState();
    MockWorker.instance = null;
    globalMessageHandler = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useMLS());

    expect(result.current.isInitialized).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.userId).toBeNull();
  });

  it('initializes MLS client', async () => {
    const { result } = renderHook(() => useMLS());

    // Set handler before initialize creates the worker
    setGlobalMessageHandler((data) => {
      if ((data as { type: string }).type === 'init') {
        return { type: 'initialized', success: true };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });
  });

  it('sets error on initialization failure', async () => {
    const { result } = renderHook(() => useMLS());

    // Set handler before initialize creates the worker
    setGlobalMessageHandler(() => ({
      type: 'error',
      message: 'Failed to initialize'
    }));

    await act(async () => {
      try {
        await result.current.initialize('user-123');
      } catch {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to initialize');
    });
  });

  it('generates key packages', async () => {
    const { result } = renderHook(() => useMLS());

    // Set handler before initialize creates the worker
    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'generateKeyPackages') {
        return {
          type: 'keyPackages',
          packages: [
            { id: 'kp-1', data: 'package-data-1' },
            { id: 'kp-2', data: 'package-data-2' }
          ]
        };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let packages: Array<{ id: string; data: string }> = [];
    await act(async () => {
      packages = await result.current.generateKeyPackages(2);
    });

    expect(packages).toHaveLength(2);
    expect(packages[0]?.id).toBe('kp-1');
  });

  it('creates a group', async () => {
    const { result } = renderHook(() => useMLS());

    // Set handler before initialize creates the worker
    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'createGroup') {
        return {
          type: 'groupCreated',
          groupId: 'local-group-id',
          mlsGroupId: 'mls-group-id'
        };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let groupResult: { groupId: string; mlsGroupId: string } | null = null;
    await act(async () => {
      groupResult = await result.current.createGroup('Test Group');
    });

    expect(groupResult?.groupId).toBe('local-group-id');
    expect(groupResult?.mlsGroupId).toBe('mls-group-id');
  });

  it('encrypts a message', async () => {
    const { result } = renderHook(() => useMLS());

    // Set handler before initialize creates the worker
    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'encrypt') {
        return {
          type: 'encrypted',
          ciphertext: 'encrypted-data',
          epoch: 1
        };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let encryptResult: { ciphertext: string; epoch: number } | null = null;
    await act(async () => {
      encryptResult = await result.current.encrypt('group-1', 'Hello world');
    });

    expect(encryptResult?.ciphertext).toBe('encrypted-data');
    expect(encryptResult?.epoch).toBe(1);
  });

  it('decrypts a message', async () => {
    const { result } = renderHook(() => useMLS());

    // Set handler before initialize creates the worker
    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'decrypt') {
        return {
          type: 'decrypted',
          plaintext: 'Hello world',
          senderIndex: 0
        };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let decryptResult: { plaintext: string; senderIndex: number } | null = null;
    await act(async () => {
      decryptResult = await result.current.decrypt('group-1', 'encrypted-data');
    });

    expect(decryptResult?.plaintext).toBe('Hello world');
    expect(decryptResult?.senderIndex).toBe(0);
  });

  it('throws error when not initialized - generateKeyPackages', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.generateKeyPackages(5)).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('throws error when not initialized - createGroup', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.createGroup('Test')).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('throws error when not initialized - joinGroup', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.joinGroup('welcome')).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('throws error when not initialized - addMembers', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.addMembers('group', ['kp'])).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('throws error when not initialized - encrypt', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.encrypt('group', 'msg')).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('throws error when not initialized - decrypt', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.decrypt('group', 'cipher')).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('throws error when not initialized - getEpoch', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.getEpoch('group')).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('throws error when not initialized - exportState', async () => {
    const { result } = renderHook(() => useMLS());

    await expect(result.current.exportState()).rejects.toThrow(
      'MLS client not initialized'
    );
  });

  it('skips re-initialization for same user', async () => {
    const { result } = renderHook(() => useMLS());
    let initCount = 0;

    // Set handler before initialize creates the worker
    setGlobalMessageHandler((data) => {
      if ((data as { type: string }).type === 'init') {
        initCount++;
        return { type: 'initialized', success: true };
      }
      return null;
    });

    // First initialization
    await act(async () => {
      await result.current.initialize('user-123');
    });

    // Second initialization attempt for same user (should be skipped)
    await act(async () => {
      await result.current.initialize('user-123');
    });

    expect(initCount).toBe(1);
  });

  it('resets state via resetMlsState', async () => {
    const { result, rerender } = renderHook(() => useMLS());

    // Set handler before initialize creates the worker
    setGlobalMessageHandler((data) => {
      if ((data as { type: string }).type === 'init') {
        return { type: 'initialized', success: true };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    expect(result.current.isInitialized).toBe(true);

    act(() => {
      resetMlsState();
    });

    rerender();

    expect(result.current.isInitialized).toBe(false);
  });

  it('joins a group', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'joinGroup') {
        return {
          type: 'groupJoined',
          groupId: 'joined-group-id',
          mlsGroupId: 'joined-mls-group-id'
        };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let joinResult: { groupId: string; mlsGroupId: string } | null = null;
    await act(async () => {
      joinResult = await result.current.joinGroup('welcome-data');
    });

    expect(joinResult?.groupId).toBe('joined-group-id');
    expect(joinResult?.mlsGroupId).toBe('joined-mls-group-id');
  });

  it('adds members to a group', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'addMembers') {
        return {
          type: 'membersAdded',
          commit: 'commit-data',
          welcomes: [
            { keyPackageRef: 'kp-ref-1', welcome: 'welcome-1' },
            { keyPackageRef: 'kp-ref-2', welcome: 'welcome-2' }
          ]
        };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let addResult: {
      commit: string;
      welcomes: Array<{ keyPackageRef: string; welcome: string }>;
    } | null = null;
    await act(async () => {
      addResult = await result.current.addMembers('group-1', ['kp-1', 'kp-2']);
    });

    expect(addResult?.commit).toBe('commit-data');
    expect(addResult?.welcomes).toHaveLength(2);
  });

  it('gets epoch for a group', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'getEpoch') {
        return { type: 'epoch', epoch: 5 };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let epoch = 0;
    await act(async () => {
      epoch = await result.current.getEpoch('group-1');
    });

    expect(epoch).toBe(5);
  });

  it('exports state', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'exportState') {
        return {
          type: 'stateExported',
          state: { groups: [], identity: 'test' }
        };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    let exportedState: unknown = null;
    await act(async () => {
      exportedState = await result.current.exportState();
    });

    expect(exportedState).toEqual({ groups: [], identity: 'test' });
  });
});
