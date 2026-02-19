import { generateKeyPair, type VfsKeyPair } from '@tearleads/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ItemKeyRecord,
  ItemKeyStore,
  UserKeyProvider
} from './keyManagerRuntime';
import { createVfsSecurePipelineBundle } from './secureWritePipelineFactory';
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

describe('createVfsSecurePipelineBundle', () => {
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

  it('creates bundle with engine, key manager, and facade factory', () => {
    const ownerKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
      itemKeyStore,
      recipientPublicKeyResolver: {
        resolvePublicKey: vi.fn(async () => null)
      },
      createKeySetupPayload: vi.fn(async () => ({
        publicEncryptionKey: 'pub-key',
        publicSigningKey: 'sign-key',
        encryptedPrivateKeys: 'enc-keys',
        argon2Salt: 'salt'
      }))
    });

    expect(bundle.engine).toBeDefined();
    expect(bundle.keyManager).toBeDefined();
    expect(bundle.createFacade).toBeDefined();
  });

  it('creates item key and encrypts blob with full pipeline', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
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
    });

    const ownerKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
      itemKeyStore,
      recipientPublicKeyResolver: {
        resolvePublicKey: vi.fn(async () => null)
      },
      createKeySetupPayload: vi.fn()
    });

    const createResult = await bundle.keyManager.createItemKey({
      itemId: 'item-1'
    });
    expect(createResult.keyEpoch).toBe(1);

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = bundle.createFacade(orchestrator, { relationKind: 'file' });

    const plaintext = new TextEncoder().encode('Test data for encryption');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'text/plain',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result.stagingId).toBeTruthy();
    expect(result.manifest.keyEpoch).toBe(1);
    expect(result.manifest.totalPlaintextBytes).toBe(plaintext.length);

    const isValid = await bundle.engine.verifyManifest(result.manifest);
    expect(isValid).toBe(true);
  });

  it('rotates key epoch and re-encrypts with new key', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
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
    });

    const ownerKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
      itemKeyStore,
      recipientPublicKeyResolver: {
        resolvePublicKey: vi.fn(async () => null)
      },
      createKeySetupPayload: vi.fn()
    });

    await bundle.keyManager.createItemKey({ itemId: 'item-2' });

    const rotateResult = await bundle.keyManager.rotateItemKeyEpoch({
      itemId: 'item-2',
      reason: 'unshare'
    });
    expect(rotateResult.newEpoch).toBe(2);

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = bundle.createFacade(orchestrator);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('After rotation'));
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-2',
      blobId: 'blob-2',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result.manifest.keyEpoch).toBe(2);

    const isValid = await bundle.engine.verifyManifest(result.manifest);
    expect(isValid).toBe(true);
  });

  it('throws error when no key epoch exists for item', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
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
    });

    const ownerKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
      itemKeyStore,
      recipientPublicKeyResolver: {
        resolvePublicKey: vi.fn(async () => null)
      },
      createKeySetupPayload: vi.fn()
    });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = bundle.createFacade(orchestrator);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Data'));
        controller.close();
      }
    });

    await expect(
      facade.stageAttachEncryptedBlobAndPersist({
        itemId: 'nonexistent-item',
        blobId: 'blob-1',
        stream,
        expiresAt: '2026-02-20T00:00:00.000Z'
      })
    ).rejects.toThrow('No key epoch found for item nonexistent-item');
  });

  it('includes wrapped keys for shares with matching key epoch', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
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
    });

    const ownerKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    itemKeyStore._shares.set('item-shared', [
      { recipientUserId: 'user-alice', keyEpoch: 1 },
      { recipientUserId: 'user-bob', keyEpoch: 1 },
      { recipientUserId: 'user-charlie', keyEpoch: 2 }
    ]);

    const resolvePublicKey = vi.fn(async (userId: string) => {
      if (userId === 'user-alice') {
        return {
          publicKeyId: 'pk-alice',
          publicEncryptionKey: 'enc-key-alice'
        };
      }
      if (userId === 'user-bob') {
        return null;
      }
      return null;
    });

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
      itemKeyStore,
      recipientPublicKeyResolver: { resolvePublicKey },
      createKeySetupPayload: vi.fn()
    });

    await bundle.keyManager.createItemKey({ itemId: 'item-shared' });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = bundle.createFacade(orchestrator);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Shared data'));
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-shared',
      blobId: 'blob-shared',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result.manifest.wrappedFileKeys).toHaveLength(1);
    expect(result.manifest.wrappedFileKeys[0]).toEqual({
      recipientUserId: 'user-alice',
      recipientPublicKeyId: 'pk-alice',
      keyEpoch: 1,
      encryptedKey: '',
      senderSignature: ''
    });

    expect(resolvePublicKey).toHaveBeenCalledWith('user-alice');
    expect(resolvePublicKey).toHaveBeenCalledWith('user-bob');
    expect(resolvePublicKey).not.toHaveBeenCalledWith('user-charlie');
  });

  it('filters out shares with non-matching key epoch', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
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
    });

    const ownerKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    itemKeyStore._shares.set('item-epoch-mismatch', [
      { recipientUserId: 'user-old', keyEpoch: 99 }
    ]);

    const resolvePublicKey = vi.fn(async () => ({
      publicKeyId: 'pk-old',
      publicEncryptionKey: 'enc-key-old'
    }));

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
      itemKeyStore,
      recipientPublicKeyResolver: { resolvePublicKey },
      createKeySetupPayload: vi.fn()
    });

    await bundle.keyManager.createItemKey({ itemId: 'item-epoch-mismatch' });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = bundle.createFacade(orchestrator);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Epoch mismatch data'));
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-epoch-mismatch',
      blobId: 'blob-epoch-mismatch',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result.manifest.keyEpoch).toBe(1);
    expect(result.manifest.wrappedFileKeys).toHaveLength(0);
    expect(resolvePublicKey).not.toHaveBeenCalled();
  });

  it('throws error when item key not found in store for engine operation', async () => {
    const ownerKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(ownerKeyPair),
      itemKeyStore,
      recipientPublicKeyResolver: {
        resolvePublicKey: vi.fn(async () => null)
      },
      createKeySetupPayload: vi.fn()
    });

    await expect(
      bundle.engine.encryptChunk({
        itemId: 'missing-item',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext: new Uint8Array([1, 2, 3]),
        keyEpoch: 1
      })
    ).rejects.toThrow('Item key not found for itemId=missing-item, keyEpoch=1');
  });
});
