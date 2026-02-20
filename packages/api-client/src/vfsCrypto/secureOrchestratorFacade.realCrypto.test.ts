import { generateKeyPair, type VfsKeyPair } from '@tearleads/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVfsCryptoEngine } from './engineRuntime';
import type {
  ItemKeyRecord,
  ItemKeyStore,
  UserKeyProvider
} from './keyManagerRuntime';
import {
  createVfsSecureOrchestratorFacade,
  createVfsSecureOrchestratorFacadeWithRuntime
} from './secureOrchestratorFacade';
import { createVfsSecurePipelineBundle } from './secureWritePipelineFactory';
import { createVfsSecureWritePipeline } from './secureWritePipelineRuntime';
import type { Epoch, ItemId } from './types';

function generateTestKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function createTestKeyResolver() {
  const keys = new Map<string, Uint8Array>();
  return {
    setKey(itemId: string, epoch: number, key: Uint8Array): void {
      keys.set(`${itemId}:${epoch}`, key);
    },
    getItemKey: vi.fn(
      ({ itemId, keyEpoch }: { itemId: string; keyEpoch: number }) => {
        const key = keys.get(`${itemId}:${keyEpoch}`);
        if (!key) {
          throw new Error(`Key not found for ${itemId}:${keyEpoch}`);
        }
        return key;
      }
    )
  };
}

describe('secureOrchestratorFacade with real crypto', () => {
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

  it('encrypts blob stream with real VfsCryptoEngine', async () => {
    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-1', 1, testKey);

    const engine = createVfsCryptoEngine({ keyResolver });
    const pipeline = createVfsSecureWritePipeline({
      engine,
      chunkSizeBytes: 64,
      resolveKeyEpoch: () => 1
    });

    const plaintext = new TextEncoder().encode(
      'This is test data for encryption verification.'
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await pipeline.uploadEncryptedBlob({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'text/plain',
      stream
    });

    expect(result.manifest.itemId).toBe('item-1');
    expect(result.manifest.blobId).toBe('blob-1');
    expect(result.manifest.keyEpoch).toBe(1);
    expect(result.manifest.totalPlaintextBytes).toBe(plaintext.length);
    expect(result.manifest.chunkCount).toBe(1);
    expect(result.manifest.manifestSignature).toBeTruthy();
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].isFinal).toBe(true);
    expect(result.chunks[0].ciphertextBase64).toBeTruthy();

    const isValid = await engine.verifyManifest(result.manifest);
    expect(isValid).toBe(true);
  });

  it('encrypts multi-chunk blob with real crypto and verifies manifest', async () => {
    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-2', 3, testKey);

    const engine = createVfsCryptoEngine({ keyResolver });
    const pipeline = createVfsSecureWritePipeline({
      engine,
      chunkSizeBytes: 32,
      resolveKeyEpoch: () => 3
    });

    const plaintext = new Uint8Array(100);
    crypto.getRandomValues(plaintext);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await pipeline.uploadEncryptedBlob({
      itemId: 'item-2',
      blobId: 'blob-2',
      stream
    });

    expect(result.manifest.chunkCount).toBeGreaterThan(1);
    expect(result.manifest.totalPlaintextBytes).toBe(100);
    expect(result.chunks).toHaveLength(result.manifest.chunkCount);

    const finalChunks = result.chunks.filter((c) => c.isFinal);
    expect(finalChunks).toHaveLength(1);
    expect(finalChunks[0].chunkIndex).toBe(result.manifest.chunkCount - 1);

    const isValid = await engine.verifyManifest(result.manifest);
    expect(isValid).toBe(true);
  });

  it('queues encrypted blob through facade with real crypto', async () => {
    vi.mocked(global.fetch).mockImplementation(
      async (
        input: RequestInfo | URL,
        _init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        if (url.includes('/v1/vfs/crdt')) {
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
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-3', 5, testKey);

    const engine = createVfsCryptoEngine({ keyResolver });
    const pipeline = createVfsSecureWritePipeline({
      engine,
      chunkSizeBytes: 128,
      resolveKeyEpoch: () => 5
    });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = createVfsSecureOrchestratorFacade(orchestrator, pipeline, {
      relationKind: 'file'
    });

    const plaintext = new TextEncoder().encode('Hello, encrypted VFS!');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-3',
      blobId: 'blob-3',
      contentType: 'text/plain',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result.stagingId).toBeTruthy();
    expect(result.manifest.keyEpoch).toBe(5);
    expect(result.manifest.totalPlaintextBytes).toBe(plaintext.length);

    const isValid = await engine.verifyManifest(result.manifest);
    expect(isValid).toBe(true);

    expect(orchestrator.queuedBlobOperations().length).toBeGreaterThanOrEqual(
      4
    );
  });

  it('creates facade with runtime options factory', async () => {
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

    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-4', 1, testKey);

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = createVfsSecureOrchestratorFacadeWithRuntime(
      orchestrator,
      {
        engine: createVfsCryptoEngine({ keyResolver }),
        chunkSizeBytes: 256,
        resolveKeyEpoch: () => 1
      },
      { relationKind: 'photo' }
    );

    const plaintext = new TextEncoder().encode('Photo data');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-4',
      blobId: 'blob-4',
      contentType: 'image/jpeg',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result.stagingId).toBeTruthy();
    expect(result.manifest.contentType).toBe('image/jpeg');
  });

  it('encrypts CRDT operation with real crypto engine', async () => {
    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-5', 2, testKey);

    const engine = createVfsCryptoEngine({ keyResolver });
    const pipeline = createVfsSecureWritePipeline({
      engine,
      resolveKeyEpoch: () => 2
    });

    const result = await pipeline.encryptCrdtOp({
      itemId: 'item-5',
      opType: 'link_add',
      opPayload: { key: 'sensitive', value: 'data' }
    });

    expect(result.keyEpoch).toBe(2);
    expect(result.encryptedOp).toBeTruthy();
    expect(result.opNonce).toBeTruthy();
    expect(result.opAad).toBeTruthy();
    expect(result.opSignature).toBeTruthy();

    expect(result.encryptedOp).not.toContain('sensitive');
    expect(result.encryptedOp).not.toContain('data');
  });

  it('auto-creates item key on first upload with real crypto pipeline bundle', async () => {
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
    const itemKeyStore = createRealCryptoMockItemKeyStore();
    const userKeyProvider = createRealCryptoMockUserKeyProvider(ownerKeyPair);

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider,
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

    const facade = bundle.createFacade(orchestrator, { relationKind: 'file' });

    // Verify no key exists before upload
    expect(await itemKeyStore.getLatestKeyEpoch('first-upload-item')).toBe(
      null
    );

    const plaintext = new TextEncoder().encode(
      'First upload with auto-created key using real crypto'
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'first-upload-item',
      blobId: 'blob-first',
      contentType: 'text/plain',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    // Verify key was auto-created
    expect(result.manifest.keyEpoch).toBe(1);
    expect(await itemKeyStore.getLatestKeyEpoch('first-upload-item')).toBe(1);

    // Verify encryption worked with real crypto
    expect(result.stagingId).toBeTruthy();
    expect(result.manifest.totalPlaintextBytes).toBe(plaintext.length);
    expect(result.manifest.chunkCount).toBe(1);
    expect(result.manifest.manifestSignature).toBeTruthy();

    const isValid = await bundle.engine.verifyManifest(result.manifest);
    expect(isValid).toBe(true);

    // Verify subsequent upload uses the same key epoch
    const stream2 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Second upload'));
        controller.close();
      }
    });

    const result2 = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'first-upload-item',
      blobId: 'blob-second',
      contentType: 'text/plain',
      stream: stream2,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result2.manifest.keyEpoch).toBe(1);
    expect(await itemKeyStore.getLatestKeyEpoch('first-upload-item')).toBe(1);
  });
});

function createRealCryptoMockUserKeyProvider(
  keyPair: VfsKeyPair
): UserKeyProvider {
  return {
    getUserKeyPair: vi.fn(async () => keyPair),
    getUserId: vi.fn(async () => 'user-owner'),
    getPublicKeyId: vi.fn(async () => 'pk-owner')
  };
}

function createRealCryptoMockItemKeyStore(): ItemKeyStore {
  const records = new Map<string, ItemKeyRecord>();

  return {
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
        _itemId: ItemId
      ): Promise<Array<{ recipientUserId: string; keyEpoch: Epoch }>> => {
        return [];
      }
    )
  };
}
