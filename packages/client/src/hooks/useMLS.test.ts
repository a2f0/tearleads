import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMlsState, useMLS } from './useMLS';

// Default message handler for tests - can be overridden per test
// Handler receives data and returns response payload (without requestId)
let globalMessageHandler:
  | ((data: unknown) => Record<string, unknown> | null)
  | null = null;

interface MockWorkerRequest {
  type: string;
  requestId: string;
  [key: string]: unknown;
}

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;
  private messageHandler:
    | ((data: unknown) => Record<string, unknown> | null)
    | null = null;

  constructor(_url: URL, _options?: WorkerOptions) {
    MockWorker.instance = this;
    // Apply any pre-configured global handler
    if (globalMessageHandler) {
      this.messageHandler = globalMessageHandler;
    }
  }

  postMessage(data: unknown) {
    if (this.messageHandler) {
      const request = data as MockWorkerRequest;
      const responsePayload = this.messageHandler(data);
      if (this.onmessage && responsePayload) {
        // Include the requestId from the request in the response
        const response = { ...responsePayload, requestId: request.requestId };
        this.onmessage(new MessageEvent('message', { data: response }));
      }
    }
  }

  setMessageHandler(
    handler: (data: unknown) => Record<string, unknown> | null
  ) {
    this.messageHandler = handler;
  }

  terminate() {}

  static instance: MockWorker | null = null;
}

vi.stubGlobal('Worker', MockWorker);

// Helper to set up message handler before worker is created
function setGlobalMessageHandler(
  handler: (data: unknown) => Record<string, unknown> | null
) {
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

    const groupResult = await act(async () => {
      return result.current.createGroup('Test Group');
    });

    expect((groupResult as { groupId: string }).groupId).toBe('local-group-id');
    expect((groupResult as { mlsGroupId: string }).mlsGroupId).toBe(
      'mls-group-id'
    );
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

    const encryptResult = await act(async () => {
      return result.current.encrypt('group-1', 'Hello world');
    });

    expect((encryptResult as { ciphertext: string }).ciphertext).toBe(
      'encrypted-data'
    );
    expect((encryptResult as { epoch: number }).epoch).toBe(1);
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

    const decryptResult = await act(async () => {
      return result.current.decrypt('group-1', 'encrypted-data');
    });

    expect(decryptResult).not.toBeNull();
    expect(
      (decryptResult as { plaintext: string; senderIndex: number }).plaintext
    ).toBe('Hello world');
    expect(
      (decryptResult as { plaintext: string; senderIndex: number }).senderIndex
    ).toBe(0);
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

    const joinResult = await act(async () => {
      return result.current.joinGroup('welcome-data');
    });

    expect((joinResult as { groupId: string }).groupId).toBe('joined-group-id');
    expect((joinResult as { mlsGroupId: string }).mlsGroupId).toBe(
      'joined-mls-group-id'
    );
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

    const addResult = await act(async () => {
      return result.current.addMembers('group-1', ['kp-1', 'kp-2']);
    });

    expect((addResult as { commit: string }).commit).toBe('commit-data');
    expect((addResult as { welcomes: unknown[] }).welcomes).toHaveLength(2);
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

  it('returns null for commit messages in decrypt', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'decrypt') {
        return { type: 'commitProcessed' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    const decryptResult = await act(async () => {
      return result.current.decrypt('group-1', 'commit-ciphertext');
    });

    expect(decryptResult).toBeNull();
  });

  it('throws on unexpected response type - createGroup', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'createGroup') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.createGroup('Test')).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('throws on unexpected response type - decrypt', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'decrypt') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.decrypt('group-1', 'cipher')).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('throws on unexpected response type - getEpoch', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'getEpoch') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.getEpoch('group-1')).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('throws on unexpected response type - exportState', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'exportState') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.exportState()).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('throws on unexpected response type - generateKeyPackages', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'generateKeyPackages') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.generateKeyPackages(5)).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('throws on unexpected response type - joinGroup', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'joinGroup') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.joinGroup('welcome')).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('throws on unexpected response type - addMembers', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'addMembers') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.addMembers('group', ['kp'])).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('throws on unexpected response type - encrypt', async () => {
    const { result } = renderHook(() => useMLS());

    setGlobalMessageHandler((data) => {
      const msg = data as { type: string };
      if (msg.type === 'init') {
        return { type: 'initialized', success: true };
      }
      if (msg.type === 'encrypt') {
        return { type: 'unexpectedType' };
      }
      return null;
    });

    await act(async () => {
      await result.current.initialize('user-123');
    });

    await expect(result.current.encrypt('group', 'msg')).rejects.toThrow(
      'Unexpected response type'
    );
  });

  it('handles worker error and rejects pending requests', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { result, rerender } = renderHook(() => useMLS());

    // Handler that doesn't respond, so request stays pending
    setGlobalMessageHandler(() => null);

    // Start an operation that won't complete
    const initPromise = act(async () => {
      return result.current.initialize('user-123').catch((e) => e);
    });

    // Give time for the request to be sent
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate worker error
    const worker = MockWorker.instance;
    if (worker?.onerror) {
      act(() => {
        worker.onerror?.(
          new ErrorEvent('error', { message: 'Worker crashed' })
        );
      });
    }

    // The pending request should be rejected
    const error = await initPromise;
    expect(error).toBeInstanceOf(Error);

    rerender();
    expect(result.current.error).toBe('Worker crashed');

    consoleError.mockRestore();
  });

  it('warns when receiving response for unknown request', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useMLS());

    // Configure handler to respond normally to init (to create worker and set up onmessage)
    setGlobalMessageHandler((data) => {
      if ((data as { type: string }).type === 'init') {
        return { type: 'initialized', success: true };
      }
      return null;
    });

    // Initialize to create the worker
    await act(async () => {
      await result.current.initialize('user-123');
    });

    // Now manually send a response with unknown requestId
    const worker = MockWorker.instance;
    if (worker?.onmessage) {
      worker.onmessage(
        new MessageEvent('message', {
          data: { type: 'initialized', requestId: 'unknown-request-id' }
        })
      );
    }

    expect(consoleWarn).toHaveBeenCalledWith(
      'Received response for unknown request:',
      expect.objectContaining({ requestId: 'unknown-request-id' })
    );

    consoleWarn.mockRestore();
  });

  it('rejects pending requests when resetMlsState is called', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { result } = renderHook(() => useMLS());

    // Handler that doesn't respond, so request stays pending
    setGlobalMessageHandler(() => null);

    let initPromise: Promise<void> = Promise.resolve();

    // Start an operation that won't complete
    await act(async () => {
      initPromise = result.current.initialize('user-123');
      // Give time for the request to be sent
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Reset state while request is pending
    act(() => {
      resetMlsState();
    });

    // The pending request should be rejected with 'Instance switched'
    await expect(initPromise).rejects.toThrow('Instance switched');

    consoleError.mockRestore();
  });
});
