import { decodeVfsCrdtSyncResponseProtobuf } from '@tearleads/vfs-sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

const sessionStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(sessionStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string) => {
    sessionStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    sessionStore.delete(key);
    return Promise.resolve(1);
  }),
  sAdd: vi.fn(() => Promise.resolve(1)),
  sRem: vi.fn(() => Promise.resolve(1)),
  expire: vi.fn(() => Promise.resolve(1))
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient),
  getRedisSubscriberOverride: () => mockRedisClient,
  setRedisSubscriberOverrideForTesting: vi.fn()
}));

interface BinaryParserResponse {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void;
  on(event: 'end', listener: () => void): void;
}

function binaryParser(
  res: BinaryParserResponse,
  callback: (error: Error | null, body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk) => {
    chunks.push(Buffer.from(chunk));
  });
  res.on('end', () => {
    callback(null, Buffer.concat(chunks));
  });
}

describe('VFS CRDT sync protobuf response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits protobuf sync payload when requested via Accept header', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          op_id: 'op-1',
          item_id: 'item-1',
          op_type: 'acl_add',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'write',
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-1',
          occurred_at: new Date('2026-02-14T00:00:00.000Z')
        }
      ]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          replica_id: 'desktop',
          max_write_id: '7'
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=10')
      .set('Authorization', authHeader)
      .set('Accept', 'application/x-protobuf')
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/x-protobuf'
    );

    if (!(response.body instanceof Buffer)) {
      throw new Error('expected protobuf response body buffer');
    }
    const decoded = decodeVfsCrdtSyncResponseProtobuf(
      new Uint8Array(response.body)
    );
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('items' in decoded) ||
      !Array.isArray(decoded.items) ||
      !('hasMore' in decoded) ||
      !('nextCursor' in decoded)
    ) {
      throw new Error('expected protobuf sync response payload');
    }

    expect(decoded.items).toHaveLength(1);
    expect(decoded.hasMore).toBe(false);
    expect(decoded.nextCursor).toBeNull();
  });
});
