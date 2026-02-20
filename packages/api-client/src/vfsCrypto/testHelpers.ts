import type { VfsKeyPair } from '@tearleads/shared';
import { vi } from 'vitest';
import type {
  ItemKeyRecord,
  ItemKeyStore,
  UserKeyProvider
} from './keyManagerRuntime';
import type { Epoch, ItemId } from './types';

export function createMockUserKeyProvider(
  keyPair: VfsKeyPair
): UserKeyProvider {
  return {
    getUserKeyPair: vi.fn(async () => keyPair),
    getUserId: vi.fn(async () => 'user-owner'),
    getPublicKeyId: vi.fn(async () => 'pk-owner')
  };
}

export function createMockItemKeyStore(): ItemKeyStore & {
  _records: Map<string, ItemKeyRecord>;
  _shares: Map<string, Array<{ recipientUserId: string; keyEpoch: Epoch }>>;
} {
  const records = new Map<string, ItemKeyRecord>();
  const shares = new Map<
    string,
    Array<{ recipientUserId: string; keyEpoch: Epoch }>
  >();

  return {
    _records: records,
    _shares: shares,
    getItemKey: vi.fn(
      async ({
        itemId,
        keyEpoch
      }: {
        itemId: ItemId;
        keyEpoch?: Epoch;
      }): Promise<ItemKeyRecord | null> => {
        if (keyEpoch !== undefined) {
          return records.get(`${itemId}:${keyEpoch}`) ?? null;
        }
        let latestRecord: ItemKeyRecord | null = null;
        let latestEpoch = 0;
        for (const [key, record] of records) {
          if (key.startsWith(`${itemId}:`) && record.keyEpoch > latestEpoch) {
            latestEpoch = record.keyEpoch;
            latestRecord = record;
          }
        }
        return latestRecord;
      }
    ),
    setItemKey: vi.fn(async (record: ItemKeyRecord): Promise<void> => {
      records.set(`${record.itemId}:${record.keyEpoch}`, record);
    }),
    getLatestKeyEpoch: vi.fn(async (itemId: ItemId): Promise<Epoch | null> => {
      let latest: Epoch | null = null;
      for (const [key, record] of records) {
        if (
          key.startsWith(`${itemId}:`) &&
          (latest === null || record.keyEpoch > latest)
        ) {
          latest = record.keyEpoch;
        }
      }
      return latest;
    }),
    listItemShares: vi.fn(
      async (
        itemId: ItemId
      ): Promise<Array<{ recipientUserId: string; keyEpoch: Epoch }>> => {
        return shares.get(itemId) ?? [];
      }
    )
  };
}

export function createMockFetchResponse(): Response {
  return new Response(
    JSON.stringify({
      clientId: 'desktop',
      results: [],
      items: [],
      hasMore: false,
      nextCursor: null,
      lastReconciledWriteIds: {}
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
