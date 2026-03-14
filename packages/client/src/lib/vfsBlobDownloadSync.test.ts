import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  discoverPendingBlobDownloads,
  fetchAllCrdtSyncItems
} from './vfsBlobDownloadSync';

function createCrdtItem(
  input: Partial<VfsCrdtSyncItem> & Pick<VfsCrdtSyncItem, 'itemId' | 'opId'>
): VfsCrdtSyncItem {
  return {
    opId: input.opId,
    itemId: input.itemId,
    opType: input.opType ?? 'item_upsert',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: null,
    childId: null,
    actorId: null,
    sourceTable: input.sourceTable ?? 'vfs_crdt_ops',
    sourceId: input.sourceId ?? input.opId,
    occurredAt: input.occurredAt ?? '2026-03-14T00:00:00.000Z',
    ...(input.blobId ? { blobId: input.blobId } : {}),
    ...(input.blobSizeBytes ? { blobSizeBytes: input.blobSizeBytes } : {}),
    ...(input.blobRelationKind
      ? { blobRelationKind: input.blobRelationKind }
      : {})
  };
}

describe('vfsBlobDownloadSync', () => {
  it('fetches all CRDT feed pages until completion', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [createCrdtItem({ itemId: 'item-1', opId: 'op-1' })],
        nextCursor: 'cursor-1',
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [createCrdtItem({ itemId: 'item-2', opId: 'op-2' })],
        nextCursor: null,
        hasMore: false
      });

    await expect(fetchAllCrdtSyncItems(fetchPage)).resolves.toEqual([
      createCrdtItem({ itemId: 'item-1', opId: 'op-1' }),
      createCrdtItem({ itemId: 'item-2', opId: 'op-2' })
    ]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, 500);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1', 500);
  });

  it('keeps only latest live blob refs and skips blobs already stored locally', async () => {
    const existsLocal = vi.fn(
      async (blobId: string) => blobId === 'blob-local'
    );
    const items = [
      createCrdtItem({
        itemId: 'item-1',
        opId: 'op-1',
        blobId: 'blob-old',
        blobSizeBytes: 64,
        blobRelationKind: 'file'
      }),
      createCrdtItem({
        itemId: 'item-2',
        opId: 'op-2',
        blobId: 'blob-deleted',
        blobSizeBytes: 32,
        blobRelationKind: 'file'
      }),
      createCrdtItem({
        itemId: 'item-1',
        opId: 'op-3',
        blobId: 'blob-live',
        blobSizeBytes: 128,
        blobRelationKind: 'file'
      }),
      createCrdtItem({
        itemId: 'item-2',
        opId: 'op-4',
        opType: 'item_delete'
      }),
      createCrdtItem({
        itemId: 'item-3',
        opId: 'op-5',
        blobId: 'blob-local',
        blobSizeBytes: 256,
        blobRelationKind: 'file'
      })
    ];

    const result = await discoverPendingBlobDownloads(items, existsLocal);

    expect(result.deletedItemIds).toEqual(new Set(['item-2']));
    expect(result.operations).toEqual([
      {
        operationId: 'download:blob-live',
        blobId: 'blob-live',
        itemId: 'item-1',
        sizeBytes: 128
      }
    ]);
    expect(existsLocal).toHaveBeenCalledWith('blob-live');
    expect(existsLocal).toHaveBeenCalledWith('blob-local');
  });
});
