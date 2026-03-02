import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import request from '../../test/connectCompatRequest.js';

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

describe('VFS CRDT sync route cache behavior', () => {
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

  it('reuses cached oldest cursor when compaction epoch is unchanged', async () => {
    const authHeader = await createAuthHeader();
    const staleCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-10T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          occurred_at: new Date('2026-02-14T00:00:00.000Z'),
          id: 'op-100'
        }
      ]
    });

    const firstResponse = await request(app)
      .get(
        `/v1/vfs/crdt/vfs-sync?limit=10&cursor=${encodeURIComponent(staleCursor)}`
      )
      .set('Authorization', authHeader);
    const secondResponse = await request(app)
      .get(
        `/v1/vfs/crdt/vfs-sync?limit=10&cursor=${encodeURIComponent(staleCursor)}`
      )
      .set('Authorization', authHeader);

    expect(firstResponse.status).toBe(409);
    expect(secondResponse.status).toBe(409);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('keys oldest-cursor cache by compaction epoch', async () => {
    const authHeader = await createAuthHeader();
    const staleCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-10T00:00:00.000Z',
      changeId: 'op-10'
    });

    sessionStore.set('vfs:crdt:compactionEpoch', '5');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          occurred_at: new Date('2026-02-14T00:00:00.000Z'),
          id: 'op-100'
        }
      ]
    });

    const firstResponse = await request(app)
      .get(
        `/v1/vfs/crdt/vfs-sync?limit=10&cursor=${encodeURIComponent(staleCursor)}`
      )
      .set('Authorization', authHeader);
    expect(firstResponse.status).toBe(409);

    sessionStore.set('vfs:crdt:compactionEpoch', '6');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          occurred_at: new Date('2026-02-15T00:00:00.000Z'),
          id: 'op-101'
        }
      ]
    });

    const secondResponse = await request(app)
      .get(
        `/v1/vfs/crdt/vfs-sync?limit=10&cursor=${encodeURIComponent(staleCursor)}`
      )
      .set('Authorization', authHeader);
    expect(secondResponse.status).toBe(409);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const setCalls = mockRedisClient.set.mock.calls.map((entry) =>
      String(entry[0])
    );
    expect(
      setCalls.some((key) => key.includes('vfs:crdt:oldestCursor:5:user-1:*'))
    ).toBe(true);
    expect(
      setCalls.some((key) => key.includes('vfs:crdt:oldestCursor:6:user-1:*'))
    ).toBe(true);
  });
});
