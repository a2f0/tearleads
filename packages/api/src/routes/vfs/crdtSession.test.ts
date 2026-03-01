import request from 'supertest';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import {
  decodeVfsCrdtSyncSessionResponseProtobuf,
  encodeVfsCrdtSyncSessionRequestProtobuf
} from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthHeader } from '../../test/auth.js';
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
    expect(response.headers['content-type']).toContain('application/x-protobuf');
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
});
