import { decodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
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
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

describe('VFS sync route', () => {
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

  it('returns 401 when not authenticated', async () => {
    const response = await request(app).get('/v1/vfs/vfs-sync');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when limit is invalid', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .get('/v1/vfs/vfs-sync?limit=0')
      .set('Authorization', authHeader);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('limit must be an integer');
  });

  it('returns 400 when cursor is invalid', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .get('/v1/vfs/vfs-sync?cursor=totally-invalid')
      .set('Authorization', authHeader);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid cursor' });
  });

  it('returns a cursor-paginated incremental page', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          change_id: 'change-1',
          item_id: 'item-1',
          change_type: 'upsert',
          changed_at: new Date('2025-01-01T00:00:00.000Z'),
          object_type: 'folder',
          owner_id: 'user-1',
          created_at: new Date('2024-12-01T00:00:00.000Z'),
          access_level: 'admin'
        },
        {
          change_id: 'change-2',
          item_id: 'item-2',
          change_type: 'delete',
          changed_at: new Date('2025-01-01T00:00:01.000Z'),
          object_type: null,
          owner_id: null,
          created_at: null,
          access_level: 'read'
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/vfs-sync?limit=1&rootId=root-123')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toEqual({
      changeId: 'change-1',
      itemId: 'item-1',
      changeType: 'upsert',
      changedAt: '2025-01-01T00:00:00.000Z',
      objectType: 'folder',
      ownerId: 'user-1',
      createdAt: '2024-12-01T00:00:00.000Z',
      accessLevel: 'admin'
    });
    expect(response.body.hasMore).toBe(true);
    expect(typeof response.body.nextCursor).toBe('string');
    expect(decodeVfsSyncCursor(response.body.nextCursor)).toEqual({
      changedAt: '2025-01-01T00:00:00.000Z',
      changeId: 'change-1'
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      'user-1',
      null,
      null,
      2,
      'root-123'
    ]);
  });

  it('returns 500 when sync rows violate ordering guardrails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          change_id: 'change-2',
          item_id: 'item-2',
          change_type: 'upsert',
          changed_at: new Date('2025-01-01T00:00:01.000Z'),
          object_type: 'folder',
          owner_id: 'user-1',
          created_at: new Date('2024-12-01T00:00:00.000Z'),
          access_level: 'admin'
        },
        {
          change_id: 'change-1',
          item_id: 'item-1',
          change_type: 'upsert',
          changed_at: new Date('2025-01-01T00:00:00.000Z'),
          object_type: 'folder',
          owner_id: 'user-1',
          created_at: new Date('2024-12-01T00:00:00.000Z'),
          access_level: 'admin'
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/vfs-sync?limit=10')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to sync VFS changes' });
    restoreConsole();
  });

  it('returns 500 when database query fails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery.mockRejectedValueOnce(new Error('Database failure'));

    const response = await request(app)
      .get('/v1/vfs/vfs-sync')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to sync VFS changes' });
    restoreConsole();
  });
});
