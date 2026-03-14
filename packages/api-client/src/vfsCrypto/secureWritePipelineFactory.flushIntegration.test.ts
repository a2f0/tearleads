import {
  generateKeyPair,
  VFS_V2_CONNECT_BASE_PATH,
  type VfsKeyPair
} from '@tearleads/shared';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../test/env.js';
import type {
  ItemKeyRecord,
  ItemKeyStore,
  UserKeyProvider
} from './keyManagerRuntime';
import { createVfsSecurePipelineBundle } from './secureWritePipelineFactory';

const RECONCILE_CURSOR_CHANGE_ID = '00000000-0000-0000-0000-000000000001';

function createMockUserKeyProvider(keyPair: VfsKeyPair): UserKeyProvider {
  return {
    getUserKeyPair: vi.fn(async () => keyPair),
    getUserId: vi.fn(async () => 'user-owner'),
    getPublicKeyId: vi.fn(async () => 'pk-owner')
  };
}

function createMockItemKeyStore(): ItemKeyStore {
  const records = new Map<string, ItemKeyRecord>();

  return {
    getItemKey: vi.fn(
      async ({ itemId, keyEpoch }: { itemId: string; keyEpoch?: number }) => {
        if (keyEpoch !== undefined) {
          return records.get(`${itemId}:${keyEpoch}`) ?? null;
        }
        let latest: ItemKeyRecord | null = null;
        for (const [key, record] of records) {
          if (!key.startsWith(`${itemId}:`)) {
            continue;
          }
          if (!latest || record.keyEpoch > latest.keyEpoch) {
            latest = record;
          }
        }
        return latest;
      }
    ),
    setItemKey: vi.fn(async (record: ItemKeyRecord) => {
      records.set(`${record.itemId}:${record.keyEpoch}`, record);
    }),
    getLatestKeyEpoch: vi.fn(async (itemId: string) => {
      let latest: number | null = null;
      for (const [key, record] of records) {
        if (!key.startsWith(`${itemId}:`)) {
          continue;
        }
        latest =
          latest === null ? record.keyEpoch : Math.max(latest, record.keyEpoch);
      }
      return latest;
    }),
    listItemShares: vi.fn(async () => [])
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getObjectField(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  return value[key];
}

function parseConnectJsonBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const nestedJson = value['json'];
  if (typeof nestedJson !== 'string') {
    return value;
  }

  const parsed = JSON.parse(nestedJson);
  return isRecord(parsed) ? parsed : {};
}

function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

describe('secureWritePipelineFactory flush integration', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    setTestEnv('VITE_API_URL', 'http://localhost');
    if (
      typeof localStorage !== 'undefined' &&
      typeof localStorage.clear === 'function'
    ) {
      localStorage.clear();
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('flushes real encrypted chunk output to blob stage endpoints', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (typeof init?.body === 'string') {
          requests.push({ url, body: JSON.parse(init.body) });
        }

        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: 'desktop',
              results: []
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.includes(`${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`)) {
          return new Response(
            connectJsonEnvelope({
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {}
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: 'desktop',
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-20T00:00:00.000Z',
                changeId: RECONCILE_CURSOR_CHANGE_ID
              }),
              lastReconciledWriteIds: { desktop: 1 }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(generateKeyPair()),
      itemKeyStore: createMockItemKeyStore(),
      recipientPublicKeyResolver: {
        resolvePublicKey: vi.fn(async () => null)
      },
      ensureUserKeys: vi.fn()
    });

    await bundle.keyManager.createItemKey({ itemId: 'item-1' });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '' }
      },
      blob: {
        baseUrl: 'http://localhost'
      }
    });

    const facade = bundle.createFacade(orchestrator, { relationKind: 'file' });
    const plaintext = new TextEncoder().encode(
      'full pipeline flush integration'
    );

    await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'text/plain',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(plaintext);
          controller.close();
        }
      }),
      expiresAt: '2026-02-21T00:00:00.000Z'
    });

    expect(orchestrator.queuedBlobOperations()).toHaveLength(4);

    await expect(orchestrator.flushAll()).resolves.toEqual({
      crdt: {
        pushedOperations: 0,
        pulledOperations: 0,
        pullPages: 1
      },
      blob: {
        processedOperations: 4,
        pendingOperations: 0
      }
    });

    const chunkRequests = requests.filter((request) =>
      request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/UploadBlobChunk`)
    );
    expect(chunkRequests.length).toBeGreaterThan(0);

    const firstChunkBody = parseConnectJsonBody(chunkRequests[0]?.body);
    const chunkIndex = getObjectField(firstChunkBody, 'chunkIndex');
    const ciphertextBase64 = getObjectField(firstChunkBody, 'ciphertextBase64');

    expect(chunkIndex).toBe(0);
    expect(typeof ciphertextBase64).toBe('string');
    if (typeof ciphertextBase64 !== 'string') {
      throw new Error('Expected ciphertextBase64 string in chunk request body');
    }
    expect(ciphertextBase64).not.toContain('full pipeline flush integration');

    expect(
      requests.some((request) =>
        request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/StageBlob`)
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/CommitBlob`)
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/AttachBlob`)
      )
    ).toBe(true);
  });

  it('flushes multi-chunk encrypted payload with contiguous chunk indices', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (typeof init?.body === 'string') {
          requests.push({ url, body: JSON.parse(init.body) });
        }

        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: 'desktop',
              results: []
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.includes(`${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`)) {
          return new Response(
            connectJsonEnvelope({
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {}
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: 'desktop',
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-20T00:00:00.000Z',
                changeId: RECONCILE_CURSOR_CHANGE_ID
              }),
              lastReconciledWriteIds: { desktop: 1 }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    const bundle = createVfsSecurePipelineBundle({
      userKeyProvider: createMockUserKeyProvider(generateKeyPair()),
      itemKeyStore: createMockItemKeyStore(),
      recipientPublicKeyResolver: {
        resolvePublicKey: vi.fn(async () => null)
      },
      ensureUserKeys: vi.fn(),
      chunkSizeBytes: 4
    });

    await bundle.keyManager.createItemKey({ itemId: 'item-multi' });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '' }
      },
      blob: {
        baseUrl: 'http://localhost'
      }
    });

    const facade = bundle.createFacade(orchestrator, { relationKind: 'file' });
    const plaintext = new TextEncoder().encode('this payload must split');

    const stageResult = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-multi',
      blobId: 'blob-multi',
      contentType: 'text/plain',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(plaintext);
          controller.close();
        }
      }),
      expiresAt: '2026-02-21T00:00:00.000Z'
    });

    expect(stageResult.manifest.chunkCount).toBeGreaterThan(1);
    await orchestrator.flushAll();

    const chunkRequests = requests.filter((request) =>
      request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/UploadBlobChunk`)
    );
    expect(chunkRequests).toHaveLength(stageResult.manifest.chunkCount);

    for (let index = 0; index < chunkRequests.length; index += 1) {
      const body = parseConnectJsonBody(chunkRequests[index]?.body);
      expect(getObjectField(body, 'chunkIndex')).toBe(index);
      expect(getObjectField(body, 'uploadId')).toBeTruthy();
    }
  });
});
