import {
  createVfsBlobDownloadFlusher,
  createVfsCryptoEngine,
  createVfsSecureReadPipeline,
  type VfsBlobDownloadOperation
} from '@tearleads/api-client/clientEntry';
import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import {
  loadVfsBlobDownloadState,
  saveVfsBlobDownloadState
} from '@/db/vfsBlobDownloadState';
import { createItemKeyStore } from '@/db/vfsItemKeys';
import { api } from '@/lib/api';
import { createStoreLogger, getOrInitializeFileStorage } from '@/storage/opfs';
import {
  resetVfsBlobDownloadOperations,
  setVfsBlobDownloadOperations
} from './vfsBlobDownloadStore';

const CLIENT_ID = 'client';
const FEED_PAGE_SIZE = 500;
const MAX_FEED_PAGES = 100;

function getCurrentFileStorageEncryptionKey(): Uint8Array {
  const encryptionKey = getKeyManager().getCurrentKey();
  if (!encryptionKey) {
    throw new Error('Database not unlocked');
  }
  return encryptionKey;
}

function createOperationId(blobId: string): string {
  return `download:${blobId}`;
}

function compareBlobDownloads(
  left: VfsBlobDownloadOperation,
  right: VfsBlobDownloadOperation
): number {
  return (
    left.itemId.localeCompare(right.itemId) ||
    left.blobId.localeCompare(right.blobId)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function toStoragePath(blobId: string): string {
  return `${blobId}.enc`;
}

export async function fetchAllCrdtSyncItems(
  fetchPage: (
    cursor?: string,
    limit?: number
  ) => Promise<{
    items: VfsCrdtSyncItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }>
): Promise<VfsCrdtSyncItem[]> {
  const allItems: VfsCrdtSyncItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_FEED_PAGES; pageIndex += 1) {
    const page = await fetchPage(cursor, FEED_PAGE_SIZE);
    allItems.push(...page.items);
    if (!page.hasMore) {
      return allItems;
    }
    if (!page.nextCursor) {
      throw new Error('vfs crdt feed reported hasMore without nextCursor');
    }
    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
      throw new Error(
        `vfs crdt feed returned a non-advancing cursor: ${page.nextCursor}`
      );
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new Error(`vfs crdt feed exceeded ${MAX_FEED_PAGES} pages`);
}

export async function discoverPendingBlobDownloads(
  items: VfsCrdtSyncItem[],
  existsLocal: (blobId: string) => Promise<boolean>
): Promise<{
  deletedItemIds: Set<string>;
  operations: VfsBlobDownloadOperation[];
}> {
  const latestByItemId = new Map<string, VfsCrdtSyncItem>();
  for (const item of items) {
    latestByItemId.set(item.itemId, item);
  }

  const deletedItemIds = new Set<string>();
  const operationsByBlobId = new Map<string, VfsBlobDownloadOperation>();

  for (const item of latestByItemId.values()) {
    if (item.opType === 'item_delete') {
      deletedItemIds.add(item.itemId);
      continue;
    }

    const blobId = typeof item.blobId === 'string' ? item.blobId.trim() : '';
    if (!blobId || !isPositiveInteger(item.blobSizeBytes)) {
      continue;
    }

    if (operationsByBlobId.has(blobId)) {
      continue;
    }

    if (await existsLocal(blobId)) {
      continue;
    }

    operationsByBlobId.set(blobId, {
      operationId: createOperationId(blobId),
      blobId,
      itemId: item.itemId,
      sizeBytes: item.blobSizeBytes
    });
  }

  const operations = Array.from(operationsByBlobId.values()).sort(
    compareBlobDownloads
  );
  return { deletedItemIds, operations };
}

function createItemKeyResolver() {
  const itemKeyStore = createItemKeyStore();
  return {
    getItemKey: async ({
      itemId,
      keyEpoch
    }: {
      itemId: string;
      keyEpoch: number;
    }) => {
      const record = await itemKeyStore.getItemKey({ itemId, keyEpoch });
      if (!record) {
        throw new Error(
          `Item key not found for itemId=${itemId}, keyEpoch=${keyEpoch}`
        );
      }
      return record.sessionKey;
    }
  };
}

export interface VfsBlobDownloadSync {
  hydrateFromPersistence(): Promise<boolean>;
  reset(): void;
  sync(): Promise<void>;
}

export function createVfsBlobDownloadSync(input: {
  instanceId: string;
  isActive?: () => boolean;
  userId: string;
}): VfsBlobDownloadSync {
  const isActive = input.isActive ?? (() => true);
  const db = getDatabase();
  const secureReadPipeline = createVfsSecureReadPipeline({
    engine: createVfsCryptoEngine({
      keyResolver: createItemKeyResolver()
    })
  });
  const flusher = createVfsBlobDownloadFlusher({
    getBlobManifest: (blobId) => api.vfs.getBlobManifest(blobId),
    getBlobChunk: (blobId, chunkIndex) =>
      api.vfs.getBlobChunk(blobId, chunkIndex),
    decryptBlob: (downloadInput) =>
      secureReadPipeline.decryptEncryptedBlob(downloadInput),
    existsLocal: async (blobId) => {
      const encryptionKey = getCurrentFileStorageEncryptionKey();
      const storage = await getOrInitializeFileStorage(
        encryptionKey,
        input.instanceId
      );
      return storage.exists(toStoragePath(blobId));
    },
    loadState: async () => loadVfsBlobDownloadState(input.userId, CLIENT_ID),
    saveState: async (state) => {
      if (!isActive()) {
        return;
      }
      await saveVfsBlobDownloadState(input.userId, CLIENT_ID, state);
      setVfsBlobDownloadOperations(state.pendingDownloads);
    },
    storeLocal: async (blobId, data) => {
      const encryptionKey = getCurrentFileStorageEncryptionKey();
      const storage = await getOrInitializeFileStorage(
        encryptionKey,
        input.instanceId
      );
      await storage.measureStore(blobId, data, createStoreLogger(db));
    }
  });
  let inFlightSync: Promise<void> | null = null;

  resetVfsBlobDownloadOperations();

  return {
    async hydrateFromPersistence(): Promise<boolean> {
      if (!isActive()) {
        return false;
      }
      const hydrated = await flusher.hydrateFromPersistence();
      if (hydrated && isActive()) {
        setVfsBlobDownloadOperations(flusher.exportState().pendingDownloads);
      }
      return hydrated;
    },
    reset(): void {
      resetVfsBlobDownloadOperations();
    },
    async sync(): Promise<void> {
      if (inFlightSync) {
        return inFlightSync;
      }

      inFlightSync = (async () => {
        if (!isActive()) {
          return;
        }

        const items = await fetchAllCrdtSyncItems((cursor, limit) =>
          api.vfs.getCrdtSync(cursor, limit)
        );
        if (!isActive()) {
          return;
        }

        const discovery = await discoverPendingBlobDownloads(
          items,
          async (blobId) => {
            const encryptionKey = getCurrentFileStorageEncryptionKey();
            const storage = await getOrInitializeFileStorage(
              encryptionKey,
              input.instanceId
            );
            return storage.exists(toStoragePath(blobId));
          }
        );
        if (!isActive()) {
          return;
        }

        flusher.dequeueForItems(discovery.deletedItemIds);
        flusher.queueDownloads(discovery.operations);
        await flusher.persistState();
        if (!isActive()) {
          return;
        }

        await flusher.flush();
        if (!isActive()) {
          return;
        }

        setVfsBlobDownloadOperations(flusher.exportState().pendingDownloads);
      })().finally(() => {
        inFlightSync = null;
      });

      return inFlightSync;
    }
  };
}
