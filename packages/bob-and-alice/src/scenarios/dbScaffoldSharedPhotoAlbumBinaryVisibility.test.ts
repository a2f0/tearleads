import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsSyncItem,
  VfsSyncResponse
} from '@tearleads/shared';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import {
  SCAFFOLD_SHARED_LOGO_SVG,
  setupBobPhotoAlbumShareForAliceDb
} from '@tearleads/shared/scaffolding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import { fetchVfsConnectJson } from '../harness/vfsConnectClient.js';

interface StoredS3Object {
  data: Uint8Array;
  contentType: string | null;
}

const s3Objects = new Map<string, StoredS3Object>();
let s3Server: Server | null = null;
const blobEnvKeys = [
  'VFS_BLOB_S3_BUCKET',
  'VFS_BLOB_S3_KEY_PREFIX',
  'VFS_BLOB_S3_ENDPOINT',
  'VFS_BLOB_S3_REGION',
  'VFS_BLOB_S3_ACCESS_KEY_ID',
  'VFS_BLOB_S3_SECRET_ACCESS_KEY',
  'VFS_BLOB_S3_FORCE_PATH_STYLE'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function startS3MockServer(): Promise<string> {
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathParts = url.pathname.split('/').filter((part) => part.length > 0);
    if (pathParts.length < 2) {
      response.writeHead(400);
      response.end('invalid s3 path');
      return;
    }

    const bucket = decodeURIComponent(pathParts[0] ?? '');
    const key = pathParts
      .slice(1)
      .map((part) => decodeURIComponent(part))
      .join('/');
    const storageKey = `${bucket}/${key}`;

    if (method === 'PUT') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const data = Buffer.concat(chunks);
        const contentTypeHeader = request.headers['content-type'];
        const contentType =
          typeof contentTypeHeader === 'string' ? contentTypeHeader : null;
        s3Objects.set(storageKey, { data, contentType });
        response.writeHead(200, { ETag: '"mock-etag"' });
        response.end();
      });
      return;
    }

    if (method === 'GET') {
      const stored = s3Objects.get(storageKey);
      if (!stored) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        ...(stored.contentType ? { 'Content-Type': stored.contentType } : {})
      });
      response.end(Buffer.from(stored.data));
      return;
    }

    if (method === 'DELETE') {
      s3Objects.delete(storageKey);
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(405);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  s3Server = server;
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve S3 mock server address');
  }
  const info: AddressInfo = address;
  return `http://127.0.0.1:${String(info.port)}`;
}

async function stopS3MockServer(): Promise<void> {
  if (!s3Server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    s3Server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  s3Server = null;
}

function resetBlobEnv(): void {
  if (typeof vi !== 'undefined' && typeof vi.unstubAllEnvs === 'function') {
    vi.unstubAllEnvs();
    return;
  }
  for (const key of blobEnvKeys) {
    delete process.env[key];
  }
}

function setBlobEnv(key: (typeof blobEnvKeys)[number], value: string): void {
  if (typeof vi !== 'undefined' && typeof vi.stubEnv === 'function') {
    vi.stubEnv(key, value);
    return;
  }
  process.env[key] = value;
}

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

async function postVfsConnectJson(
  actor: ReturnType<ApiScenarioHarness['actor']>,
  harnessInstance: ApiScenarioHarness,
  methodName: 'StageBlob' | 'UploadBlobChunk' | 'CommitBlob' | 'AttachBlob',
  body: Record<string, unknown>
): Promise<void> {
  const response = await fetch(
    `${harnessInstance.ctx.baseUrl}/v1/connect/tearleads.v1.VfsService/${methodName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${actor.user.accessToken}`,
        'X-Organization-Id': actor.user.organizationId
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `${methodName} failed with ${String(response.status)}: ${errorBody}`
    );
  }

  const connectEnvelope: unknown = await response.json();
  if (
    !isRecord(connectEnvelope) ||
    typeof connectEnvelope['json'] !== 'string'
  ) {
    throw new Error(`${methodName} returned invalid connect json envelope`);
  }
  JSON.parse(connectEnvelope['json']);
}

async function fetchAllSyncItems(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<VfsSyncItem[]> {
  const all: VfsSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchVfsConnectJson<VfsSyncResponse>({
      actor,
      methodName: 'GetSync',
      requestBody: {
        limit: 500,
        cursor
      }
    });
    all.push(...page.items);

    if (!page.hasMore) {
      break;
    }
    if (!page.nextCursor) {
      throw new Error('vfs-sync returned hasMore=true without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return all;
}

async function fetchAllCrdtItems(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<VfsCrdtSyncItem[]> {
  const all: VfsCrdtSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: {
        limit: 500,
        cursor
      }
    });
    all.push(...page.items);

    if (!page.hasMore) {
      break;
    }
    if (!page.nextCursor) {
      throw new Error('crdt/vfs-sync returned hasMore=true without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return all;
}

function buildPublicEncryptionKey(): string {
  const keyPair = generateKeyPair();
  return combinePublicKey(
    serializePublicKey({
      x25519PublicKey: keyPair.x25519PublicKey,
      mlKemPublicKey: keyPair.mlKemPublicKey
    })
  );
}

function readUpsertName(
  items: VfsSyncItem[],
  itemId: string
): string | undefined {
  const row = items.find(
    (item) => item.itemId === itemId && item.changeType === 'upsert'
  );
  return typeof row?.encryptedName === 'string' ? row.encryptedName : undefined;
}

describe('DB scaffolding shared photo album binary visibility', () => {
  let harness: ApiScenarioHarness | null = null;

  beforeEach(async () => {
    resetBlobEnv();
    s3Objects.clear();
    const s3Endpoint = await startS3MockServer();
    setBlobEnv('VFS_BLOB_S3_BUCKET', 'blob-bucket');
    setBlobEnv('VFS_BLOB_S3_KEY_PREFIX', 'scaffold');
    setBlobEnv('VFS_BLOB_S3_ENDPOINT', s3Endpoint);
    setBlobEnv('VFS_BLOB_S3_REGION', 'us-east-1');
    setBlobEnv('VFS_BLOB_S3_ACCESS_KEY_ID', 'test-access-key');
    setBlobEnv('VFS_BLOB_S3_SECRET_ACCESS_KEY', 'test-secret-key');
    setBlobEnv('VFS_BLOB_S3_FORCE_PATH_STYLE', 'true');
  });

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
    await stopS3MockServer();
    resetBlobEnv();
    s3Objects.clear();
  });

  it('writes scaffolded logo via blob commit and exposes album/photo names to Bob and Alice sync', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

    const client = await harness.ctx.pool.connect();
    let seeded: Awaited<ReturnType<typeof setupBobPhotoAlbumShareForAliceDb>>;
    try {
      const bobPublicKey = buildPublicEncryptionKey();
      const alicePublicKey = buildPublicEncryptionKey();

      await client.query(
        `INSERT INTO user_keys (
           user_id,
           public_encryption_key,
           public_signing_key,
           encrypted_private_keys,
           argon2_salt,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           public_encryption_key = EXCLUDED.public_encryption_key`,
        [
          bob.user.userId,
          bobPublicKey,
          'seeded-signing-key-bob',
          'seeded-private-keys-bob',
          'seeded-argon2-salt-bob'
        ]
      );
      await client.query(
        `INSERT INTO user_keys (
           user_id,
           public_encryption_key,
           public_signing_key,
           encrypted_private_keys,
           argon2_salt,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           public_encryption_key = EXCLUDED.public_encryption_key`,
        [
          alice.user.userId,
          alicePublicKey,
          'seeded-signing-key-alice',
          'seeded-private-keys-alice',
          'seeded-argon2-salt-alice'
        ]
      );

      seeded = await setupBobPhotoAlbumShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email
      });
    } finally {
      client.release();
    }

    const logoBytes = new TextEncoder().encode(SCAFFOLD_SHARED_LOGO_SVG);
    const logoBase64 = Buffer.from(logoBytes).toString('base64');
    const blobId = 'shared-logo-blob';
    const stagingId = 'shared-logo-stage';
    const uploadId = 'shared-logo-upload';
    await postVfsConnectJson(bob, harness, 'StageBlob', {
      json: JSON.stringify({
        stagingId,
        blobId,
        expiresAt: '2099-01-01T00:00:00.000Z'
      })
    });

    await postVfsConnectJson(bob, harness, 'UploadBlobChunk', {
      stagingId,
      json: JSON.stringify({
        uploadId,
        chunkIndex: 0,
        isFinal: true,
        nonce: 'nonce-1',
        aadHash: 'aad-1',
        ciphertextBase64: logoBase64,
        plaintextLength: logoBytes.byteLength,
        ciphertextLength: logoBytes.byteLength
      })
    });

    await postVfsConnectJson(bob, harness, 'CommitBlob', {
      stagingId,
      json: JSON.stringify({
        uploadId,
        keyEpoch: 1,
        manifestHash: 'manifest-hash-1',
        manifestSignature: 'manifest-signature-1',
        chunkCount: 1,
        totalPlaintextBytes: logoBytes.byteLength,
        totalCiphertextBytes: logoBytes.byteLength
      })
    });

    await postVfsConnectJson(bob, harness, 'AttachBlob', {
      stagingId,
      json: JSON.stringify({
        itemId: seeded.photoId,
        relationKind: 'photo'
      })
    });

    const stored = s3Objects.get('blob-bucket/scaffold/shared-logo-blob');
    expect(stored).toBeDefined();
    if (!stored) {
      throw new Error('Expected mocked S3 object to exist after commit');
    }
    expect(Buffer.from(stored.data).toString('utf8')).toBe(
      SCAFFOLD_SHARED_LOGO_SVG
    );

    const [bobSyncItems, bobCrdtItems, aliceSyncItems, aliceCrdtItems] =
      await Promise.all([
        fetchAllSyncItems(bob),
        fetchAllCrdtItems(bob),
        fetchAllSyncItems(alice),
        fetchAllCrdtItems(alice)
      ]);

    expect(readUpsertName(bobSyncItems, seeded.albumId)).toBe(
      'Photos shared with Alice'
    );
    expect(readUpsertName(bobSyncItems, seeded.photoId)).toBe(
      'Tearleads logo.svg'
    );

    expect(readUpsertName(aliceSyncItems, seeded.albumId)).toBe(
      'Photos shared with Alice'
    );
    expect(readUpsertName(aliceSyncItems, seeded.photoId)).toBe(
      'Tearleads logo.svg'
    );

    expect(
      bobCrdtItems.some(
        (item) =>
          item.opType === 'link_add' &&
          item.parentId === seeded.photoId &&
          item.childId === blobId
      )
    ).toBe(true);

    expect(
      aliceCrdtItems.some(
        (item) =>
          item.opType === 'acl_add' &&
          item.itemId === seeded.photoId &&
          item.principalType === 'user' &&
          item.principalId === alice.user.userId
      )
    ).toBe(true);
  });
});
