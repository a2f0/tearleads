import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import * as dbState from '@/db/state';
import {
  addItemShare,
  createItemKeyStore,
  getItemKey,
  getLatestKeyEpoch,
  listItemShares,
  removeItemShare,
  setItemKey
} from './vfsItemKeys';

function createMockAdapter(
  executeFn: DatabaseAdapter['execute']
): DatabaseAdapter {
  return {
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isOpen: vi.fn(() => true),
    execute: executeFn,
    executeMany: vi.fn(async () => {}),
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    rekeyDatabase: vi.fn(async () => {}),
    getConnection: vi.fn(() => async () => ({ rows: [] })),
    exportDatabase: vi.fn(async () => new Uint8Array()),
    importDatabase: vi.fn(async () => {})
  };
}

describe('vfsItemKeys', () => {
  let mockExecute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecute = vi.fn().mockResolvedValue({ rows: [] });
    const adapter = createMockAdapter(mockExecute);
    vi.spyOn(dbState, 'getDatabaseAdapter').mockReturnValue(adapter);
    vi.spyOn(dbState, 'isDatabaseInitialized').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getItemKey', () => {
    it('returns null when database is not initialized', async () => {
      vi.spyOn(dbState, 'isDatabaseInitialized').mockReturnValue(false);

      const result = await getItemKey({ itemId: 'item-1' });

      expect(result).toBeNull();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns item key with specific epoch', async () => {
      const sessionKeyB64 = btoa(String.fromCharCode(...new Uint8Array(32)));
      mockExecute.mockResolvedValueOnce({
        rows: [
          {
            itemId: 'item-1',
            keyEpoch: 3,
            sessionKeyB64
          }
        ]
      });

      const result = await getItemKey({ itemId: 'item-1', keyEpoch: 3 });

      expect(result).not.toBeNull();
      expect(result?.itemId).toBe('item-1');
      expect(result?.keyEpoch).toBe(3);
      expect(result?.sessionKey).toBeInstanceOf(Uint8Array);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('AND key_epoch = ?'),
        ['item-1', 3]
      );
    });

    it('returns latest key when no epoch specified', async () => {
      const sessionKeyB64 = btoa(String.fromCharCode(...new Uint8Array(32)));
      mockExecute.mockResolvedValueOnce({
        rows: [
          {
            itemId: 'item-1',
            keyEpoch: 5,
            sessionKeyB64
          }
        ]
      });

      const result = await getItemKey({ itemId: 'item-1' });

      expect(result?.keyEpoch).toBe(5);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY key_epoch DESC'),
        ['item-1']
      );
    });

    it('returns null when key not found', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const result = await getItemKey({ itemId: 'nonexistent' });

      expect(result).toBeNull();
    });
  });

  describe('setItemKey', () => {
    it('throws when database is not initialized', async () => {
      vi.spyOn(dbState, 'isDatabaseInitialized').mockReturnValue(false);

      await expect(
        setItemKey({
          itemId: 'item-1',
          keyEpoch: 1,
          sessionKey: new Uint8Array(32)
        })
      ).rejects.toThrow('Database not initialized');
    });

    it('inserts item key', async () => {
      const sessionKey = new Uint8Array(32).fill(42);

      await setItemKey({
        itemId: 'item-1',
        keyEpoch: 1,
        sessionKey
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO vfs_item_keys'),
        expect.arrayContaining(['item-1', 1, expect.any(String)])
      );
    });
  });

  describe('getLatestKeyEpoch', () => {
    it('returns null when database is not initialized', async () => {
      vi.spyOn(dbState, 'isDatabaseInitialized').mockReturnValue(false);

      const result = await getLatestKeyEpoch('item-1');

      expect(result).toBeNull();
    });

    it('returns latest epoch', async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [{ maxEpoch: 7 }]
      });

      const result = await getLatestKeyEpoch('item-1');

      expect(result).toBe(7);
    });

    it('returns null when no keys exist', async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [{ maxEpoch: null }]
      });

      const result = await getLatestKeyEpoch('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listItemShares', () => {
    it('returns empty array when database is not initialized', async () => {
      vi.spyOn(dbState, 'isDatabaseInitialized').mockReturnValue(false);

      const result = await listItemShares('item-1');

      expect(result).toEqual([]);
    });

    it('returns shares for item', async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [
          { recipientUserId: 'user-2', keyEpoch: 3 },
          { recipientUserId: 'user-3', keyEpoch: 3 }
        ]
      });

      const result = await listItemShares('item-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ recipientUserId: 'user-2', keyEpoch: 3 });
      expect(result[1]).toEqual({ recipientUserId: 'user-3', keyEpoch: 3 });
    });
  });

  describe('addItemShare', () => {
    it('throws when database is not initialized', async () => {
      vi.spyOn(dbState, 'isDatabaseInitialized').mockReturnValue(false);

      await expect(
        addItemShare({
          itemId: 'item-1',
          recipientUserId: 'user-2',
          keyEpoch: 1
        })
      ).rejects.toThrow('Database not initialized');
    });

    it('inserts share record', async () => {
      await addItemShare({
        itemId: 'item-1',
        recipientUserId: 'user-2',
        keyEpoch: 1
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO vfs_item_shares'),
        expect.arrayContaining(['item-1', 'user-2', 1])
      );
    });
  });

  describe('removeItemShare', () => {
    it('throws when database is not initialized', async () => {
      vi.spyOn(dbState, 'isDatabaseInitialized').mockReturnValue(false);

      await expect(
        removeItemShare({
          itemId: 'item-1',
          recipientUserId: 'user-2'
        })
      ).rejects.toThrow('Database not initialized');
    });

    it('deletes share record', async () => {
      await removeItemShare({
        itemId: 'item-1',
        recipientUserId: 'user-2'
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM vfs_item_shares'),
        ['item-1', 'user-2']
      );
    });
  });

  describe('createItemKeyStore', () => {
    it('returns store with all methods', () => {
      const store = createItemKeyStore();

      expect(store).toHaveProperty('getItemKey');
      expect(store).toHaveProperty('setItemKey');
      expect(store).toHaveProperty('getLatestKeyEpoch');
      expect(store).toHaveProperty('listItemShares');
      expect(store).toHaveProperty('addItemShare');
      expect(store).toHaveProperty('removeItemShare');
    });
  });
});
