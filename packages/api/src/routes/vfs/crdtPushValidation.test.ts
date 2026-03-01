import request from 'supertest';
import {
  decodeVfsCrdtPushResponseProtobuf,
  encodeVfsCrdtPushRequestProtobuf
} from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthHeader } from '../../test/auth.js';
import {
  buildLinkPushPayload,
  buildValidPushPayload,
  mockClientRelease,
  mockQuery,
  setupCrdtPushRouteTestEnv,
  teardownCrdtPushRouteTestEnv
} from './crdtPushTestSupport.js';

async function postCrdtPush(
  payload: object | string | undefined,
  authHeader?: string
) {
  const { app } = await import('../../index.js');
  const requestBuilder = request(app).post('/v1/vfs/crdt/push');
  if (authHeader) {
    requestBuilder.set('Authorization', authHeader);
  }

  return requestBuilder.send(payload);
}

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

describe('VFS CRDT push route validation', { timeout: 15_000 }, () => {
  beforeEach(() => {
    setupCrdtPushRouteTestEnv();
  });

  afterEach(() => {
    teardownCrdtPushRouteTestEnv();
  });

  it('returns 401 when not authenticated', async () => {
    const response = await postCrdtPush({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when payload is invalid', async () => {
    const authHeader = await createAuthHeader();
    const response = await postCrdtPush(
      {
        clientId: 'bad:client',
        operations: 'not-an-array'
      },
      authHeader
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('clientId');
  });

  it('returns 400 when payload is not an object', async () => {
    const authHeader = await createAuthHeader();
    const response = await postCrdtPush('invalid-payload', authHeader);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId and operations are required'
    });
  });

  it('returns 400 when operations is not an array', async () => {
    const authHeader = await createAuthHeader();
    const response = await postCrdtPush(
      {
        clientId: 'desktop',
        operations: 'bad-shape'
      },
      authHeader
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'operations must be an array' });
  });

  it('returns 400 when operation count exceeds limit', async () => {
    const authHeader = await createAuthHeader();
    const operations = Array.from({ length: 501 }, (_, index) => ({
      opId: `desktop-${index + 1}`,
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: index + 1,
      occurredAt: '2026-02-14T20:00:00.000Z',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read'
    }));

    const response = await postCrdtPush(
      {
        clientId: 'desktop',
        operations
      },
      authHeader
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'operations exceeds max entries (500)'
    });
  });

  it('returns invalidOp for malformed operations and still commits', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        clientId: 'desktop',
        operations: [
          {
            opId: 'bad-op',
            opType: 'acl_add'
          }
        ]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'bad-op', status: 'invalidOp' }]
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(mockQuery.mock.calls[1]?.[0]).toBe('COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns invalidOp for non-object operation entries', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        clientId: 'desktop',
        operations: [null]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'invalid-0', status: 'invalidOp' }]
    });
  });

  it('accepts protobuf push payloads and emits protobuf responses', async () => {
    const authHeader = await createAuthHeader();
    const { app } = await import('../../index.js');
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .set('Content-Type', 'application/x-protobuf')
      .set('Accept', 'application/x-protobuf')
      .buffer(true)
      .parse(binaryParser)
      .send(
        Buffer.from(
          encodeVfsCrdtPushRequestProtobuf({
            clientId: 'desktop',
            operations: [
              {
                opId: 'bad-op',
                opType: 'acl_add',
                itemId: 'item-1',
                replicaId: 'desktop',
                writeId: 1,
                occurredAt: '2026-02-14T20:00:00.000Z'
              }
            ]
          })
        )
      );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-protobuf');

    if (!(response.body instanceof Buffer)) {
      throw new Error('expected protobuf response body buffer');
    }
    const decoded = decodeVfsCrdtPushResponseProtobuf(
      new Uint8Array(response.body)
    );
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('clientId' in decoded) ||
      !('results' in decoded) ||
      !Array.isArray(decoded.results)
    ) {
      throw new Error('expected protobuf push response payload');
    }
    expect(decoded.clientId).toBe('desktop');
    expect(decoded.results).toEqual([{ opId: 'bad-op', status: 'invalidOp' }]);
  });

  it('returns invalidOp for replica mismatch', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            replicaId: 'mobile'
          }
        ]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for acl operation without valid principal', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            principalType: 'invalid-type'
          }
        ]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for acl_add without valid access level', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            accessLevel: 'owner'
          }
        ]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for link operation without parentId', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      buildLinkPushPayload({ parentId: '   ' }),
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for link payload with childId mismatch', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      buildLinkPushPayload({ childId: 'item-2' }),
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for self-referential link payloads', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      buildLinkPushPayload({ parentId: 'item-1' }),
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'invalidOp' }]
    });
  });
});
