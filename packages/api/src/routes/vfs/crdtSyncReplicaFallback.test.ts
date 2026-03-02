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

describe('VFS CRDT sync replica fallback', () => {
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

  it('uses legacy replica write-id scan when replica-head reads are disabled', async () => {
    vi.stubEnv('VFS_CRDT_REPLICA_HEADS_READS', 'false');
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: []
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          replica_id: 'desktop',
          max_write_id: '2'
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=10')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.lastReconciledWriteIds).toEqual({ desktop: 2 });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(String(mockQuery.mock.calls[1]?.[0])).toContain('FROM vfs_crdt_ops');
    expect(String(mockQuery.mock.calls[1]?.[0])).toContain(
      'split_part(source_id'
    );
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([
      'vfs_crdt_client_push',
      'user-1'
    ]);
  });
});
