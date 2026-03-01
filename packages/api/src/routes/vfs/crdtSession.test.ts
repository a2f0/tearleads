import {
  decodeVfsCrdtSyncSessionResponseProtobuf,
  encodeVfsCrdtSyncSessionRequestProtobuf,
  encodeVfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockClientRelease,
  mockQuery,
  setupCrdtPushRouteTestEnv,
  teardownCrdtPushRouteTestEnv
} from './crdtPushTestSupport.js';

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

describe('VFS CRDT sync session route', { timeout: 15_000 }, () => {
  beforeEach(() => {
    setupCrdtPushRouteTestEnv();
  });

  afterEach(() => {
    teardownCrdtPushRouteTestEnv();
  });

  it('returns 401 when not authenticated', async () => {
    const { app } = await import('../../index.js');
    const response = await request(app).post('/v1/vfs/crdt/session').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when cursor is invalid', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor: 'not-a-cursor',
        limit: 10,
        operations: []
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid cursor' });
  });

  it('returns 400 when payload is not an object', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send('invalid');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId, cursor, and limit are required'
    });
  });

  it('returns 400 when cursor is missing', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        limit: 10,
        operations: []
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'cursor is required' });
  });

  it('returns 400 for malformed protobuf request body', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .set('Content-Type', 'application/x-protobuf')
      .send(Buffer.from([0xde, 0xad, 0xbe, 0xef]));

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('invalid protobuf request body');
  });

  it('returns 400 when limit is out of range', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 0,
        operations: []
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'limit must be an integer between 1 and 500'
    });
  });

  it('returns 400 for invalid lastReconciledWriteIds payload', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 10,
        operations: [],
        lastReconciledWriteIds: {
          desktop: 0
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('lastReconciledWriteIds');
  });

  it('treats non-array operations payload as empty operations', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pull query
      .mockResolvedValueOnce({ rows: [] }) // replica write ids query
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: new Date('2026-02-14T20:10:00.000Z'),
            last_reconciled_change_id: 'desktop-1',
            last_reconciled_write_ids: { desktop: 1 }
          }
        ]
      }) // reconcile upsert
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 10,
        operations: {}
      });

    expect(response.status).toBe(200);
    expect(response.body.push).toEqual({
      clientId: 'desktop',
      results: []
    });
    expect(response.body.reconcile).toEqual({
      clientId: 'desktop',
      cursor,
      lastReconciledWriteIds: { desktop: 1 }
    });
  });

  it('returns 400 when string limit is not parseable', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 'not-a-number',
        operations: []
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'limit must be an integer between 1 and 500'
    });
  });

  it('returns 400 when clientId is invalid', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop:bad',
        cursor,
        limit: 10,
        operations: []
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId must be non-empty, <=128 chars, and must not contain ":"'
    });
  });

  it('returns 500 and rolls back when reconcile upsert row is missing', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pull query
      .mockResolvedValueOnce({ rows: [] }) // replica write ids query
      .mockResolvedValueOnce({ rows: [] }) // reconcile upsert returns no row
      .mockResolvedValueOnce({}); // ROLLBACK

    const consoleErrorSpy = mockConsoleError();
    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 10,
        operations: [],
        lastReconciledWriteIds: { desktop: 1 }
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to run CRDT sync session'
    });
    expect(mockQuery.mock.calls.map((entry) => entry[0])).toContain('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('accepts protobuf payloads and emits protobuf session responses', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pull query
      .mockResolvedValueOnce({ rows: [] }) // replica write ids query
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: new Date('2026-02-14T20:10:00.000Z'),
            last_reconciled_change_id: 'desktop-1',
            last_reconciled_write_ids: { desktop: 1 }
          }
        ]
      }) // reconcile upsert
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .set('Content-Type', 'application/x-protobuf')
      .set('Accept', 'application/x-protobuf')
      .buffer(true)
      .parse(binaryParser)
      .send(
        Buffer.from(
          encodeVfsCrdtSyncSessionRequestProtobuf({
            clientId: 'desktop',
            cursor,
            limit: 10,
            operations: [],
            lastReconciledWriteIds: { desktop: 1 }
          })
        )
      );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/x-protobuf'
    );
    if (!(response.body instanceof Buffer)) {
      throw new Error('expected protobuf session response body buffer');
    }

    const decoded = decodeVfsCrdtSyncSessionResponseProtobuf(
      new Uint8Array(response.body)
    );
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('push' in decoded) ||
      !('pull' in decoded) ||
      !('reconcile' in decoded)
    ) {
      throw new Error('expected protobuf sync session response payload');
    }

    expect(decoded.push).toEqual({
      clientId: 'desktop',
      results: []
    });
    expect(decoded.pull).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
      lastReconciledWriteIds: {}
    });
    expect(decoded.reconcile).toEqual({
      clientId: 'desktop',
      cursor,
      lastReconciledWriteIds: { desktop: 1 }
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('accepts JSON payloads with string limit and trimmed rootId', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pull query
      .mockResolvedValueOnce({ rows: [] }) // replica write ids query
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: new Date('2026-02-14T20:10:00.000Z'),
            last_reconciled_change_id: 'desktop-1',
            last_reconciled_write_ids: { desktop: 1 }
          }
        ]
      }) // reconcile upsert
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: '10',
        operations: [],
        rootId: '  root-folder  ',
        lastReconciledWriteIds: { desktop: 1 }
      });

    expect(response.status).toBe(200);
    expect(response.body.push).toEqual({
      clientId: 'desktop',
      results: []
    });
    expect(response.body.pull).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
      lastReconciledWriteIds: {}
    });
    expect(response.body.reconcile).toEqual({
      clientId: 'desktop',
      cursor,
      lastReconciledWriteIds: { desktop: 1 }
    });
    expect(mockQuery.mock.calls[1]?.[1]).toContain('root-folder');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
