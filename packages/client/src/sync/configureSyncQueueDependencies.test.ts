import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('configureSyncQueueDependencies', () => {
  beforeEach(() => {
    if (typeof vi.resetModules === 'function') {
      vi.resetModules();
    }
  });
  it('configures sync queue dependencies only once', async () => {
    const setSyncQueueDependencies = vi.fn();

    vi.doMock('@tearleads/vfs-sync/clientEntry', () => ({
      setSyncQueueDependencies
    }));
    vi.doMock('@/contexts/VfsOrchestratorContext', () => ({
      useVfsOrchestratorInstance: vi.fn(() => null)
    }));

    const { configureSyncQueueDependencies } = await import(
      './configureSyncQueueDependencies'
    );

    configureSyncQueueDependencies();
    configureSyncQueueDependencies();

    expect(setSyncQueueDependencies).toHaveBeenCalledTimes(1);
    expect(setSyncQueueDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        useSnapshot: expect.any(Function)
      })
    );
  });

  it('useSnapshot returns empty snapshot when no orchestrator', async () => {
    const setSyncQueueDependencies = vi.fn();

    vi.doMock('@tearleads/vfs-sync/clientEntry', () => ({
      setSyncQueueDependencies
    }));
    vi.doMock('@/contexts/VfsOrchestratorContext', () => ({
      useVfsOrchestratorInstance: vi.fn(() => null)
    }));

    const { configureSyncQueueDependencies } = await import(
      './configureSyncQueueDependencies'
    );

    configureSyncQueueDependencies();

    const deps = setSyncQueueDependencies.mock.calls[0][0];
    const { result } = renderHook(() => deps.useSnapshot());

    expect(result.current).toEqual({
      outbound: { crdt: [], blob: [] },
      inbound: {
        cursor: null,
        pendingOperations: 0,
        nextLocalWriteId: 0,
        blobDownloads: []
      }
    });
  });

  it('useSnapshot maps orchestrator data to snapshot', async () => {
    const setSyncQueueDependencies = vi.fn();
    const mockOrchestrator = {
      queuedCrdtOperations: vi.fn(() => [
        {
          opId: 'op-1',
          opType: 'upsert',
          itemId: 'item-1',
          writeId: 1,
          occurredAt: '2026-01-01T00:00:00Z',
          encryptedPayload: new Uint8Array()
        }
      ]),
      queuedBlobOperations: vi.fn(() => [
        {
          operationId: 'blob-1',
          kind: 'upload',
          payload: { stagingId: 'stg-1', itemId: 'itm-1', chunkIndex: 0 }
        }
      ]),
      crdt: {
        snapshot: vi.fn(() => ({
          cursor: { changedAt: '2026-01-01', changeId: 'c-1' },
          pendingOperations: 3,
          nextLocalWriteId: 5
        }))
      }
    };

    vi.doMock('@tearleads/vfs-sync/clientEntry', () => ({
      setSyncQueueDependencies
    }));
    vi.doMock('@/contexts/VfsOrchestratorContext', () => ({
      useVfsOrchestratorInstance: vi.fn(() => mockOrchestrator)
    }));

    const { configureSyncQueueDependencies } = await import(
      './configureSyncQueueDependencies'
    );

    configureSyncQueueDependencies();

    const deps = setSyncQueueDependencies.mock.calls[0][0];
    const { result } = renderHook(() => deps.useSnapshot());

    expect(result.current).toEqual({
      outbound: {
        crdt: [
          {
            opId: 'op-1',
            opType: 'upsert',
            itemId: 'item-1',
            writeId: 1,
            occurredAt: '2026-01-01T00:00:00Z',
            encrypted: true
          }
        ],
        blob: [
          {
            operationId: 'blob-1',
            kind: 'upload',
            stagingId: 'stg-1',
            itemId: 'itm-1',
            chunkIndex: 0
          }
        ]
      },
      inbound: {
        cursor: { changedAt: '2026-01-01', changeId: 'c-1' },
        pendingOperations: 3,
        nextLocalWriteId: 5,
        blobDownloads: []
      }
    });
  });

  it('useSnapshot marks ops without encryptedPayload as not encrypted', async () => {
    const setSyncQueueDependencies = vi.fn();
    const mockOrchestrator = {
      queuedCrdtOperations: vi.fn(() => [
        {
          opId: 'op-2',
          opType: 'delete',
          itemId: 'item-2',
          writeId: 2,
          occurredAt: '2026-01-02T00:00:00Z'
        }
      ]),
      queuedBlobOperations: vi.fn(() => []),
      crdt: {
        snapshot: vi.fn(() => ({
          cursor: null,
          pendingOperations: 0,
          nextLocalWriteId: 1
        }))
      }
    };

    vi.doMock('@tearleads/vfs-sync/clientEntry', () => ({
      setSyncQueueDependencies
    }));
    vi.doMock('@/contexts/VfsOrchestratorContext', () => ({
      useVfsOrchestratorInstance: vi.fn(() => mockOrchestrator)
    }));

    const { configureSyncQueueDependencies } = await import(
      './configureSyncQueueDependencies'
    );

    configureSyncQueueDependencies();

    const deps = setSyncQueueDependencies.mock.calls[0][0];
    const { result } = renderHook(() => deps.useSnapshot());

    expect(result.current.outbound.crdt[0].encrypted).toBe(false);
  });

  it('useSnapshot handles blob ops without payload fields', async () => {
    const setSyncQueueDependencies = vi.fn();
    const mockOrchestrator = {
      queuedCrdtOperations: vi.fn(() => []),
      queuedBlobOperations: vi.fn(() => [
        {
          operationId: 'blob-2',
          kind: 'delete',
          payload: {}
        }
      ]),
      crdt: {
        snapshot: vi.fn(() => ({
          cursor: null,
          pendingOperations: 0,
          nextLocalWriteId: 1
        }))
      }
    };

    vi.doMock('@tearleads/vfs-sync/clientEntry', () => ({
      setSyncQueueDependencies
    }));
    vi.doMock('@/contexts/VfsOrchestratorContext', () => ({
      useVfsOrchestratorInstance: vi.fn(() => mockOrchestrator)
    }));

    const { configureSyncQueueDependencies } = await import(
      './configureSyncQueueDependencies'
    );

    configureSyncQueueDependencies();

    const deps = setSyncQueueDependencies.mock.calls[0][0];
    const { result } = renderHook(() => deps.useSnapshot());

    expect(result.current.outbound.blob[0]).toEqual({
      operationId: 'blob-2',
      kind: 'delete',
      stagingId: undefined,
      itemId: undefined,
      chunkIndex: undefined
    });
  });
});
