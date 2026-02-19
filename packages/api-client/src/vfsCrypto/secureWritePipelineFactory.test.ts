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
});
