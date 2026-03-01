import {
  decodeVfsCrdtReconcileResponseProtobuf,
  encodeVfsCrdtReconcileRequestProtobuf,
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
  getRedisClient: () => Promise.resolve(mockRedisClient),
  getRedisSubscriberOverride: () => mockRedisClient,
  setRedisSubscriberOverrideForTesting: vi.fn()
}));

function binaryParser(
  res: NodeJS.ReadableStream,
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

describe('VFS CRDT reconcile route', () => {
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
    const response = await request(app).post('/v1/vfs/crdt/reconcile').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid payload', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
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
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor: 'not-valid'
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid cursor' });
  });

  it('returns 400 for invalid replica write-id payload', async () => {
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        lastReconciledWriteIds: {
          desktop: 0
        }
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error:
        'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
    });
  });

  it('returns 400 when clientId uses reserved namespace delimiter', async () => {
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop:crdt',
        cursor
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId must not contain ":"'
    });
  });

  it('stores cursor under CRDT-scoped client key and returns merged write ids', async () => {
    const authHeader = await createAuthHeader();
    const incomingCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-02-14T00:00:00.000Z'),
          last_reconciled_change_id: 'op-10',
          last_reconciled_write_ids: {
            desktop: 10,
            mobile: 3
          }
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor: incomingCursor,
        lastReconciledWriteIds: {
          mobile: 3,
          desktop: 10
        }
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      cursor: expect.any(String),
      lastReconciledWriteIds: {
        desktop: 10,
        mobile: 3
      }
    });
    expect(decodeVfsSyncCursor(response.body.cursor)).toEqual({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      'user-1',
      'crdt:desktop',
      '2026-02-14T00:00:00.000Z',
      'op-10',
      '{"desktop":10,"mobile":3}'
    ]);
  });

  it('accepts protobuf reconcile payloads and emits protobuf responses', async () => {
    const authHeader = await createAuthHeader();
    const incomingCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-02-14T00:00:00.000Z'),
          last_reconciled_change_id: 'op-10',
          last_reconciled_write_ids: {
            desktop: 10
          }
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .set('Content-Type', 'application/x-protobuf')
      .set('Accept', 'application/x-protobuf')
      .buffer(true)
      .parse(binaryParser)
      .send(
        Buffer.from(
          encodeVfsCrdtReconcileRequestProtobuf({
            clientId: 'desktop',
            cursor: incomingCursor,
            lastReconciledWriteIds: { desktop: 10 }
          })
        )
      );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-protobuf');

    if (!(response.body instanceof Buffer)) {
      throw new Error('expected protobuf response body buffer');
    }
    const decoded = decodeVfsCrdtReconcileResponseProtobuf(
      new Uint8Array(response.body)
    );
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('clientId' in decoded) ||
      !('cursor' in decoded) ||
      !('lastReconciledWriteIds' in decoded)
    ) {
      throw new Error('expected protobuf reconcile response payload');
    }
    if (typeof decoded.cursor !== 'string') {
      throw new Error('expected protobuf reconcile cursor string');
    }

    expect(decoded.clientId).toBe('desktop');
    expect(decodeVfsSyncCursor(decoded.cursor)).toEqual({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });
    expect(decoded.lastReconciledWriteIds).toEqual({ desktop: 10 });
  });

  it('keeps monotonic cursor when stale write arrives', async () => {
    const authHeader = await createAuthHeader();
    const staleCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-01'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-02-14T00:00:01.000Z'),
          last_reconciled_change_id: 'op-99',
          last_reconciled_write_ids: {
            desktop: 10,
            mobile: 5
          }
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor: staleCursor,
        lastReconciledWriteIds: {
          desktop: 9,
          mobile: 2
        }
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      cursor: expect.any(String),
      lastReconciledWriteIds: {
        desktop: 10,
        mobile: 5
      }
    });
    expect(decodeVfsSyncCursor(response.body.cursor)).toEqual({
      changedAt: '2026-02-14T00:00:01.000Z',
      changeId: 'op-99'
    });
  });

  it('returns 500 when persisted write ids are invalid', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-02-14T00:00:01.000Z'),
          last_reconciled_change_id: 'op-99',
          last_reconciled_write_ids: {
            desktop: 'oops'
          }
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to reconcile CRDT cursor' });
    restoreConsole();
  });

  it('returns 500 when reconcile query returns no row', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: []
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to reconcile CRDT cursor' });
    restoreConsole();
  });

  it('returns 500 when reconciled timestamp is invalid', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: 'not-a-date',
          last_reconciled_change_id: 'op-10',
          last_reconciled_write_ids: {
            desktop: 10
          }
        }
      ]
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to reconcile CRDT cursor' });
    restoreConsole();
  });

  it('returns 500 on database error', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockRejectedValueOnce(new Error('db failed'));

    const response = await request(app)
      .post('/v1/vfs/crdt/reconcile')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to reconcile CRDT cursor' });
    restoreConsole();
  });
});
