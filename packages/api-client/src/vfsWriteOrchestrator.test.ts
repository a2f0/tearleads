import type { LocalWriteOptions } from '@tearleads/local-write-orchestrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsWriteOrchestratorPersistedState } from './vfsWriteOrchestrator';

describe('vfsWriteOrchestrator', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    global.fetch = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it('persists combined CRDT and blob queue state', async () => {
    const persistedStates: VfsWriteOrchestratorPersistedState[] = [];
    const saveState = vi.fn(
      async (state: VfsWriteOrchestratorPersistedState) => {
        persistedStates.push(state);
      }
    );

    const { VfsWriteOrchestrator } = await import('./vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      saveState
    });

    await orchestrator.queueCrdtLocalOperationAndPersist({
      opType: 'link_add',
      itemId: 'child-1',
      parentId: 'parent-1',
      childId: 'child-1'
    });
    await orchestrator.queueBlobStageAndPersist({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });

    expect(saveState).toHaveBeenCalledTimes(2);
    const lastState = persistedStates[persistedStates.length - 1];
    if (!lastState) {
      throw new Error('missing persisted orchestrator state');
    }

    expect(lastState.crdt).not.toBeNull();
    expect(lastState.crdt?.pendingOperations).toHaveLength(1);
    expect(lastState.blob).not.toBeNull();
    expect(lastState.blob?.pendingOperations).toHaveLength(1);
  });

  it('routes load/save through the provided local write queue', async () => {
    const enqueue = vi.fn(
      async <T>(
        operation: () => Promise<T>,
        _options?: LocalWriteOptions
      ): Promise<T> => {
        return operation();
      }
    );
    const localWriteQueue = {
      enqueue
    };

    const persistedStates: VfsWriteOrchestratorPersistedState[] = [];
    const saveState = vi.fn(
      async (state: VfsWriteOrchestratorPersistedState) => {
        persistedStates.push(state);
      }
    );
    const loadState = vi.fn(async () => {
      return persistedStates[persistedStates.length - 1] ?? null;
    });

    const { VfsWriteOrchestrator } = await import('./vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      localWriteQueue,
      saveState,
      loadState,
      saveStateWriteOptions: { scope: 'vfs-save' },
      loadStateWriteOptions: { scope: 'vfs-load' }
    });
    await orchestrator.queueCrdtLocalOperationAndPersist({
      opType: 'link_add',
      itemId: 'child-1',
      parentId: 'parent-1',
      childId: 'child-1'
    });
    const hydratedOrchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      localWriteQueue,
      saveState,
      loadState,
      saveStateWriteOptions: { scope: 'vfs-save' },
      loadStateWriteOptions: { scope: 'vfs-load' }
    });
    await hydratedOrchestrator.hydrateFromPersistence();

    expect(enqueue).toHaveBeenCalled();
    const calledScopes = enqueue.mock.calls
      .map(([, options]) => {
        if (!options || typeof options !== 'object') {
          return null;
        }

        const optionsScope = options.scope;
        return typeof optionsScope === 'string' ? optionsScope : null;
      })
      .filter((scope): scope is string => scope !== null);
    expect(calledScopes).toEqual(
      expect.arrayContaining(['vfs-save', 'vfs-load'])
    );
  });

  it('hydrates both flushers from a single persisted snapshot', async () => {
    const { VfsWriteOrchestrator } = await import('./vfsWriteOrchestrator');
    const source = new VfsWriteOrchestrator('user-1', 'desktop');
    source.queueCrdtLocalOperation({
      opType: 'link_add',
      itemId: 'child-1',
      parentId: 'parent-1',
      childId: 'child-1'
    });
    source.queueBlobStage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });
    const persisted = source.exportState();

    const target = new VfsWriteOrchestrator('user-1', 'desktop', {
      loadState: async () => persisted
    });
    await expect(target.hydrateFromPersistence()).resolves.toBe(true);
    expect(target.queuedCrdtOperations()).toHaveLength(1);
    expect(target.queuedBlobOperations()).toHaveLength(1);
  });

  it('flushes both queues and persists final state', async () => {
    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();
        if (url.endsWith('/v1/vfs/crdt/push')) {
          return new Response(
            JSON.stringify({
              clientId: 'desktop',
              results: [{ opId: 'desktop-1', status: 'applied' }]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.includes('/v1/vfs/crdt/vfs-sync')) {
          return new Response(
            JSON.stringify({
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {}
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.endsWith('/v1/vfs/crdt/reconcile')) {
          return new Response(
            JSON.stringify({
              clientId: 'desktop',
              cursor: '2026-02-18T00:00:00.000Z|desktop-1',
              lastReconciledWriteIds: { desktop: 1 }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.endsWith('/v1/vfs/blobs/stage')) {
          return new Response(
            JSON.stringify({
              stagingId: 'stage-1',
              blobId: 'blob-1',
              status: 'staged',
              stagedAt: '2026-02-18T00:00:00.000Z',
              expiresAt: '2026-02-18T01:00:00.000Z'
            }),
            {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        throw new Error(`Unexpected request URL: ${url}`);
      }
    );

    const persisted: VfsWriteOrchestratorPersistedState[] = [];
    const saveState = vi.fn(
      async (state: VfsWriteOrchestratorPersistedState) => {
        persisted.push(state);
      }
    );

    const { VfsWriteOrchestrator } = await import('./vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: {
          baseUrl: 'http://localhost',
          apiPrefix: '/v1'
        }
      },
      blob: {
        baseUrl: 'http://localhost',
        apiPrefix: '/v1'
      },
      saveState
    });

    orchestrator.queueCrdtLocalOperation({
      opType: 'link_add',
      itemId: 'child-1',
      parentId: 'parent-1',
      childId: 'child-1'
    });
    orchestrator.queueBlobStage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });

    await expect(orchestrator.flushAll()).resolves.toEqual({
      crdt: {
        pushedOperations: 1,
        pulledOperations: 0,
        pullPages: 1
      },
      blob: {
        processedOperations: 1,
        pendingOperations: 0
      }
    });
    expect(orchestrator.queuedCrdtOperations()).toHaveLength(0);
    expect(orchestrator.queuedBlobOperations()).toHaveLength(0);
    expect(saveState).toHaveBeenCalled();

    const lastState = persisted[persisted.length - 1];
    if (!lastState) {
      throw new Error('missing persisted final state');
    }
    expect(lastState.crdt?.pendingOperations).toHaveLength(0);
    expect(lastState.blob?.pendingOperations).toHaveLength(0);
  });

  it('supports blob queue wrappers and CRDT sync wrapper', async () => {
    const pushOperations = vi.fn(async () => ({ results: [] }));
    const pullOperations = vi.fn(async () => ({
      items: [],
      hasMore: false,
      nextCursor: null,
      lastReconciledWriteIds: {}
    }));
    const reconcileState = vi.fn(async ({ cursor, lastReconciledWriteIds }) => ({
      cursor,
      lastReconciledWriteIds
    }));

    const { VfsWriteOrchestrator } = await import('./vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transport: {
          pushOperations,
          pullOperations,
          reconcileState
        }
      }
    });

    expect(orchestrator.queueBlobAttach).toBeDefined();
    expect(orchestrator.queueBlobAbandon).toBeDefined();
    orchestrator.queueBlobStage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });
    orchestrator.queueBlobAttach({
      stagingId: 'stage-1',
      itemId: 'item-1',
      relationKind: 'file'
    });
    orchestrator.queueBlobAbandon({
      stagingId: 'stage-1'
    });

    expect(orchestrator.queuedBlobOperations()).toHaveLength(3);
    await expect(orchestrator.syncCrdt()).resolves.toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(pullOperations).toHaveBeenCalledTimes(1);
  });
});
