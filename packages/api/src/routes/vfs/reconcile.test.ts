import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

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
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

describe('VFS sync reconcile route', () => {
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
    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid payload', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({ clientId: 'desktop' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId and cursor are required'
    });
  });

  it('returns 400 for invalid cursor', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor: 'not-valid'
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid cursor' });
  });

  it('returns 400 when clientId uses reserved namespace delimiter', async () => {
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2025-02-10T00:00:00.000Z',
      changeId: 'change-10'
    });

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop:sync',
        cursor
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId must not contain ":"'
    });
  });

  it('returns reconciled cursor for valid payload', async () => {
    const authHeader = await createAuthHeader();
    const incomingCursor = encodeVfsSyncCursor({
      changedAt: '2025-02-10T00:00:00.000Z',
      changeId: 'change-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2025-02-10T00:00:00.000Z'),
          last_reconciled_change_id: 'change-10'
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor: incomingCursor
      });

    expect(response.status).toBe(200);
    expect(response.body.clientId).toBe('desktop');
    expect(decodeVfsSyncCursor(response.body.cursor)).toEqual({
      changedAt: '2025-02-10T00:00:00.000Z',
      changeId: 'change-10'
    });
  });

  it('keeps monotonic cursor when stale write arrives', async () => {
    const authHeader = await createAuthHeader();
    const staleCursor = encodeVfsSyncCursor({
      changedAt: '2025-02-10T00:00:00.000Z',
      changeId: 'change-01'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2025-02-10T00:00:01.000Z'),
          last_reconciled_change_id: 'change-99'
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor: staleCursor
      });

    expect(response.status).toBe(200);
    expect(decodeVfsSyncCursor(response.body.cursor)).toEqual({
      changedAt: '2025-02-10T00:00:01.000Z',
      changeId: 'change-99'
    });
  });

  it('returns 500 when reconcile query returns no row', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2025-02-10T00:00:00.000Z',
      changeId: 'change-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: []
    });

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to reconcile sync cursor' });
    restoreConsole();
  });

  it('returns 500 when reconciled timestamp is invalid', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2025-02-10T00:00:00.000Z',
      changeId: 'change-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: 'not-a-date',
          last_reconciled_change_id: 'change-10'
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to reconcile sync cursor' });
    restoreConsole();
  });

  it('returns 500 on database error', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2025-02-10T00:00:00.000Z',
      changeId: 'change-10'
    });

    mockQuery.mockRejectedValueOnce(new Error('db failed'));

    const response = await request(app)
      .post('/v1/vfs/vfs-sync/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to reconcile sync cursor' });
    restoreConsole();
  });
});
