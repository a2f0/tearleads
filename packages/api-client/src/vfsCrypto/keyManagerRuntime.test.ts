import { generateKeyPair, type VfsKeyPair } from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import type { VfsKeySetupPayload } from './keyManager';
import {
  createVfsKeyManager,
  type ItemKeyRecord,
  type ItemKeyStore,
  type RecipientPublicKeyResolver,
  type UserKeyProvider
} from './keyManagerRuntime';
import type { Epoch, ItemId } from './types';

function createMockUserKeyProvider(keyPair: VfsKeyPair): UserKeyProvider {
  return {
    getUserKeyPair: vi.fn(async () => keyPair),
    getUserId: vi.fn(async () => 'user-owner'),
    getPublicKeyId: vi.fn(async () => 'pk-owner')
  };
}

function createMockItemKeyStore(): ItemKeyStore & {
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

function createMockRecipientResolver(
  recipientKeys: Map<
    string,
    { publicKeyId: string; publicEncryptionKey: string }
  >
): RecipientPublicKeyResolver {
  return {
    resolvePublicKey: vi.fn(async (userId: string) => {
      return recipientKeys.get(userId) ?? null;
    })
  };
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function buildPublicEncryptionKey(keyPair: VfsKeyPair): string {
  const x25519 = toBase64(keyPair.x25519PublicKey);
  const mlKem = toBase64(keyPair.mlKemPublicKey);
  return `${x25519}.${mlKem}`;
}

describe('VfsKeyManager', () => {
  describe('ensureUserKeys', () => {
    it('returns key setup payload from provided factory', async () => {
      const ownerKeyPair = generateKeyPair();
      const expectedPayload: VfsKeySetupPayload = {
        publicEncryptionKey: 'pub-key',
        publicSigningKey: 'sign-key',
        encryptedPrivateKeys: 'enc-keys',
        argon2Salt: 'salt'
      };

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore: createMockItemKeyStore(),
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn(async () => expectedPayload)
      });

      const result = await manager.ensureUserKeys();
      expect(result).toEqual(expectedPayload);
    });
  });

  describe('createItemKey', () => {
    it('ensures user keys before creating first item key', async () => {
      const ownerKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();
      const createKeySetupPayload = vi.fn(async () => ({
        publicEncryptionKey: 'pub-key',
        publicSigningKey: 'sign-key',
        encryptedPrivateKeys: 'enc-keys',
        argon2Salt: 'salt'
      }));

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload
      });

      const result = await manager.createItemKey({ itemId: 'item-1' });

      expect(result.keyEpoch).toBe(1);
      expect(createKeySetupPayload).toHaveBeenCalledTimes(1);
    });

    it('fails closed when user key bootstrap fails', async () => {
      const ownerKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn(async () => {
          throw new Error('bootstrap failed');
        })
      });

      await expect(
        manager.createItemKey({ itemId: 'item-fail' })
      ).rejects.toThrow('bootstrap failed');
      expect(itemKeyStore.setItemKey).not.toHaveBeenCalled();
    });

    it('creates first key with epoch 1', async () => {
      const ownerKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn()
      });

      const result = await manager.createItemKey({ itemId: 'item-1' });

      expect(result.keyEpoch).toBe(1);
      expect(result.ownerWrappedKey).toEqual(
        expect.objectContaining({
          recipientUserId: 'user-owner',
          recipientPublicKeyId: 'pk-owner',
          keyEpoch: 1
        })
      );
      expect(result.encryptedSessionKey.length).toBeGreaterThan(0);
      expect(itemKeyStore.setItemKey).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item-1',
          keyEpoch: 1
        })
      );
    });

    it('increments epoch for existing item', async () => {
      const ownerKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();
      itemKeyStore._records.set('item-1:1', {
        itemId: 'item-1',
        keyEpoch: 1,
        sessionKey: crypto.getRandomValues(new Uint8Array(32))
      });

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn()
      });

      const result = await manager.createItemKey({ itemId: 'item-1' });

      expect(result.keyEpoch).toBe(2);
      expect(itemKeyStore.setItemKey).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item-1',
          keyEpoch: 2
        })
      );
    });
  });

  describe('wrapItemKeyForShare', () => {
    it('wraps key for recipient', async () => {
      const ownerKeyPair = generateKeyPair();
      const recipientKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();
      const sessionKey = crypto.getRandomValues(new Uint8Array(32));
      itemKeyStore._records.set('item-1:1', {
        itemId: 'item-1',
        keyEpoch: 1,
        sessionKey
      });

      const recipientKeys = new Map([
        [
          'user-recipient',
          {
            publicKeyId: 'pk-recipient',
            publicEncryptionKey: buildPublicEncryptionKey(recipientKeyPair)
          }
        ]
      ]);

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(recipientKeys),
        createKeySetupPayload: vi.fn()
      });

      const result = await manager.wrapItemKeyForShare({
        itemId: 'item-1',
        recipientUserId: 'user-recipient',
        recipientPublicKey: buildPublicEncryptionKey(recipientKeyPair)
      });

      expect(result.recipientUserId).toBe('user-recipient');
      expect(result.recipientPublicKeyId).toBe('pk-recipient');
      expect(result.keyEpoch).toBe(1);
      expect(result.encryptedKey.length).toBeGreaterThan(0);
      expect(result.senderSignature.length).toBeGreaterThan(0);
    });

    it('throws if item key not found', async () => {
      const ownerKeyPair = generateKeyPair();
      const recipientKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();

      const recipientKeys = new Map([
        [
          'user-recipient',
          {
            publicKeyId: 'pk-recipient',
            publicEncryptionKey: buildPublicEncryptionKey(recipientKeyPair)
          }
        ]
      ]);

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(recipientKeys),
        createKeySetupPayload: vi.fn()
      });

      await expect(
        manager.wrapItemKeyForShare({
          itemId: 'item-not-found',
          recipientUserId: 'user-recipient',
          recipientPublicKey: buildPublicEncryptionKey(recipientKeyPair)
        })
      ).rejects.toThrow('Item key not found');
    });

    it('throws if recipient public key not found', async () => {
      const ownerKeyPair = generateKeyPair();
      const recipientKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();
      itemKeyStore._records.set('item-1:1', {
        itemId: 'item-1',
        keyEpoch: 1,
        sessionKey: crypto.getRandomValues(new Uint8Array(32))
      });

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn()
      });

      await expect(
        manager.wrapItemKeyForShare({
          itemId: 'item-1',
          recipientUserId: 'unknown-user',
          recipientPublicKey: buildPublicEncryptionKey(recipientKeyPair)
        })
      ).rejects.toThrow('Public key not found');
    });
  });

  describe('rotateItemKeyEpoch', () => {
    it('creates new epoch and rewraps owner key', async () => {
      const ownerKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();
      itemKeyStore._records.set('item-1:1', {
        itemId: 'item-1',
        keyEpoch: 1,
        sessionKey: crypto.getRandomValues(new Uint8Array(32))
      });

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn()
      });

      const result = await manager.rotateItemKeyEpoch({
        itemId: 'item-1',
        reason: 'unshare'
      });

      expect(result.newEpoch).toBe(2);
      expect(result.wraps).toHaveLength(1);
      expect(result.wraps[0]).toEqual(
        expect.objectContaining({
          recipientUserId: 'user-owner',
          keyEpoch: 2
        })
      );
      expect(itemKeyStore.setItemKey).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item-1',
          keyEpoch: 2
        })
      );
    });

    it('rewraps keys for all existing shares', async () => {
      const ownerKeyPair = generateKeyPair();
      const recipientKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();
      itemKeyStore._records.set('item-1:1', {
        itemId: 'item-1',
        keyEpoch: 1,
        sessionKey: crypto.getRandomValues(new Uint8Array(32))
      });
      itemKeyStore._shares.set('item-1', [
        { recipientUserId: 'user-owner', keyEpoch: 1 },
        { recipientUserId: 'user-share-1', keyEpoch: 1 }
      ]);

      const recipientKeys = new Map([
        [
          'user-share-1',
          {
            publicKeyId: 'pk-share-1',
            publicEncryptionKey: buildPublicEncryptionKey(recipientKeyPair)
          }
        ]
      ]);

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(recipientKeys),
        createKeySetupPayload: vi.fn()
      });

      const result = await manager.rotateItemKeyEpoch({
        itemId: 'item-1',
        reason: 'expiry'
      });

      expect(result.newEpoch).toBe(2);
      expect(result.wraps).toHaveLength(2);
      expect(result.wraps.map((w) => w.recipientUserId)).toContain(
        'user-owner'
      );
      expect(result.wraps.map((w) => w.recipientUserId)).toContain(
        'user-share-1'
      );
      expect(result.wraps.every((w) => w.keyEpoch === 2)).toBe(true);
    });

    it('throws if no existing key for rotation', async () => {
      const ownerKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn()
      });

      await expect(
        manager.rotateItemKeyEpoch({
          itemId: 'item-not-found',
          reason: 'manual'
        })
      ).rejects.toThrow('No existing key found');
    });

    it('skips shares for recipients whose keys cannot be resolved', async () => {
      const ownerKeyPair = generateKeyPair();
      const itemKeyStore = createMockItemKeyStore();
      itemKeyStore._records.set('item-1:1', {
        itemId: 'item-1',
        keyEpoch: 1,
        sessionKey: crypto.getRandomValues(new Uint8Array(32))
      });
      itemKeyStore._shares.set('item-1', [
        { recipientUserId: 'user-owner', keyEpoch: 1 },
        { recipientUserId: 'user-deleted', keyEpoch: 1 }
      ]);

      const manager = createVfsKeyManager({
        userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
        itemKeyStore,
        recipientPublicKeyResolver: createMockRecipientResolver(new Map()),
        createKeySetupPayload: vi.fn()
      });

      const result = await manager.rotateItemKeyEpoch({
        itemId: 'item-1',
        reason: 'unshare'
      });

      expect(result.wraps).toHaveLength(1);
      expect(result.wraps[0].recipientUserId).toBe('user-owner');
    });
  });
});
