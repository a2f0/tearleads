import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVfsSecurePipelineBundle } from './secureWritePipelineFactory';
import {
  createMockFetchResponse,
  createMockItemKeyStore,
  createMockUserKeyProvider
} from './testHelpers';

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
    vi.mocked(global.fetch).mockImplementation(async () =>
      createMockFetchResponse()
    );

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
    vi.mocked(global.fetch).mockImplementation(async () =>
      createMockFetchResponse()
    );

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

  it('auto-creates item key on first secure upload when no key exists', async () => {
    vi.mocked(global.fetch).mockImplementation(async () =>
      createMockFetchResponse()
    );

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

    // No pre-created key - the pipeline should auto-create one
    expect(await itemKeyStore.getLatestKeyEpoch('new-item')).toBe(null);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('First upload data'));
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'new-item',
      blobId: 'blob-1',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    // Key should have been auto-created with epoch 1
    expect(result.manifest.keyEpoch).toBe(1);
    expect(await itemKeyStore.getLatestKeyEpoch('new-item')).toBe(1);

    // Verify encryption worked
    expect(result.stagingId).toBeTruthy();
    expect(result.manifest.totalPlaintextBytes).toBe(17);

    const isValid = await bundle.engine.verifyManifest(result.manifest);
    expect(isValid).toBe(true);
  });

  it('dedupes concurrent first-upload key provisioning for the same item', async () => {
    vi.mocked(global.fetch).mockImplementation(async () =>
      createMockFetchResponse()
    );

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

    const originalCreateItemKey =
      bundle.keyManager.createItemKey.bind(bundle.keyManager);
    const createItemKeySpy = vi
      .spyOn(bundle.keyManager, 'createItemKey')
      .mockImplementation(async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return originalCreateItemKey(input);
      });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });

    const facade = bundle.createFacade(orchestrator);
    const createStream = (content: string): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        }
      });

    const [firstResult, secondResult] = await Promise.all([
      facade.stageAttachEncryptedBlobAndPersist({
        itemId: 'concurrent-new-item',
        blobId: 'blob-1',
        stream: createStream('first'),
        expiresAt: '2026-02-20T00:00:00.000Z'
      }),
      facade.stageAttachEncryptedBlobAndPersist({
        itemId: 'concurrent-new-item',
        blobId: 'blob-2',
        stream: createStream('second'),
        expiresAt: '2026-02-20T00:00:00.000Z'
      })
    ]);

    expect(firstResult.manifest.keyEpoch).toBe(1);
    expect(secondResult.manifest.keyEpoch).toBe(1);
    expect(await itemKeyStore.getLatestKeyEpoch('concurrent-new-item')).toBe(1);
    expect(createItemKeySpy).toHaveBeenCalledTimes(1);
  });

  it('includes wrapped keys for shares with matching key epoch', async () => {
    vi.mocked(global.fetch).mockImplementation(async () =>
      createMockFetchResponse()
    );

    const ownerKeyPair = generateKeyPair();
    const aliceKeyPair = generateKeyPair();
    const itemKeyStore = createMockItemKeyStore();

    itemKeyStore._shares.set('item-shared', [
      { recipientUserId: 'user-alice', keyEpoch: 1 },
      { recipientUserId: 'user-bob', keyEpoch: 1 },
      { recipientUserId: 'user-charlie', keyEpoch: 2 }
    ]);

    const alicePublicKey = combinePublicKey(serializePublicKey(aliceKeyPair));

    const resolvePublicKey = vi.fn(async (userId: string) => {
      if (userId === 'user-alice') {
        return { publicKeyId: 'pk-alice', publicEncryptionKey: alicePublicKey };
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

    // Should include owner's + alice's wrapped key (bob skipped - no key)
    expect(result.manifest.wrappedFileKeys).toHaveLength(2);

    // Verify owner's wrapped key
    const ownerWrap = result.manifest.wrappedFileKeys.find(
      (k) => k.recipientUserId === 'user-owner'
    );
    expect(ownerWrap).toBeDefined();
    if (!ownerWrap) throw new Error('ownerWrap not found');
    expect(ownerWrap.recipientPublicKeyId).toBe('pk-owner');
    expect(ownerWrap.keyEpoch).toBe(1);
    expect(ownerWrap.encryptedKey).toBeTruthy();
    expect(ownerWrap.encryptedKey.split('.').length).toBe(4); // HPKE format
    expect(ownerWrap.senderSignature).toBeTruthy();

    // Verify alice's wrapped key
    const aliceWrap = result.manifest.wrappedFileKeys.find(
      (k) => k.recipientUserId === 'user-alice'
    );
    expect(aliceWrap).toBeDefined();
    if (!aliceWrap) throw new Error('aliceWrap not found');
    expect(aliceWrap.recipientPublicKeyId).toBe('pk-alice');
    expect(aliceWrap.keyEpoch).toBe(1);
    expect(aliceWrap.encryptedKey).toBeTruthy();
    expect(aliceWrap.encryptedKey.split('.').length).toBe(4); // HPKE format
    expect(aliceWrap.senderSignature).toBeTruthy();

    expect(resolvePublicKey).toHaveBeenCalledWith('user-alice');
    expect(resolvePublicKey).toHaveBeenCalledWith('user-bob');
    expect(resolvePublicKey).not.toHaveBeenCalledWith('user-charlie');
  });

  it('filters out shares with non-matching key epoch', async () => {
    vi.mocked(global.fetch).mockImplementation(async () =>
      createMockFetchResponse()
    );

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
    // Only owner's wrapped key (no shares match current epoch)
    expect(result.manifest.wrappedFileKeys).toHaveLength(1);
    expect(result.manifest.wrappedFileKeys[0].recipientUserId).toBe(
      'user-owner'
    );
    expect(result.manifest.wrappedFileKeys[0].encryptedKey).toBeTruthy();
    expect(result.manifest.wrappedFileKeys[0].senderSignature).toBeTruthy();
    // user-old has epoch 99, but we're uploading with epoch 1
    expect(resolvePublicKey).not.toHaveBeenCalled();
  });

  it('throws error when item key not found in store for engine', async () => {
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
