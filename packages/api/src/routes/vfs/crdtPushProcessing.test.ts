import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  buildLinkPushPayload,
  buildValidPushPayload,
  mockClientRelease,
  mockQuery,
  mockRedisPublish,
  setupCrdtPushRouteTestEnv,
  teardownCrdtPushRouteTestEnv
} from './crdtPushTestSupport.js';

async function postCrdtPush(
  payload: object | string | undefined,
  authHeader: string
) {
  const { app } = await import('../../index.js');
  return request(app)
    .post('/v1/vfs/crdt/push')
    .set('Authorization', authHeader)
    .send(payload);
}

describe('VFS CRDT push route processing', () => {
  beforeEach(() => {
    setupCrdtPushRouteTestEnv();
  });

  afterEach(() => {
    teardownCrdtPushRouteTestEnv();
  });

  it('returns applied when operation insert succeeds', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 0 }] }) // max write
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'crdt-op-1', occurred_at: '2026-02-14T20:00:00.000Z' }]
      }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
    expect(mockQuery.mock.calls[3]?.[0]).toContain('WHERE source_table = $1');
    expect(mockQuery.mock.calls[4]?.[0]).toContain('MAX(occurred_at)');
    expect(mockRedisPublish).toHaveBeenCalledWith(
      'vfs:container:item-1:sync',
      expect.stringContaining('"type":"vfs:cursor-bump"')
    );
    expect(mockRedisPublish).toHaveBeenCalledWith(
      'vfs:container:item-1:sync',
      expect.stringContaining('"changeId":"crdt-op-1"')
    );
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('does not fail push when VFS cursor bump publish fails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockRedisPublish.mockRejectedValueOnce(new Error('publish failed'));

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 0 }] }) // max write
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'crdt-op-1', occurred_at: '2026-02-14T20:00:00.000Z' }]
      }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
    expect(mockRedisPublish).toHaveBeenCalledTimes(1);
    restoreConsole();
  });

  it('canonicalizes occurredAt when another replica already advanced actor feed time', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({
        rows: [
          {
            max_write_id: 0,
            max_occurred_at: new Date('2026-02-14T20:00:05.000Z')
          }
        ]
      }) // max write + max occurred_at
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
    expect(mockQuery.mock.calls[2]?.[1]?.[0]).toBe('vfs_crdt_feed:user-1');
    expect(mockQuery.mock.calls[5]?.[1]?.[10]).toBe('2026-02-14T20:00:05.001Z');
  });

  it('returns alreadyApplied when source id already exists', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [{ id: 'crdt-row-1' }] }) // existing source
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'alreadyApplied' }]
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns staleWriteId when replica write id is behind', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 5 }] }) // max write
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'staleWriteId' }]
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('accepts numeric string max_write_id and applies higher writeId', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: '2' }] }) // max write (string)
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            writeId: 3
          }
        ]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
  });

  it('treats unparsable max_write_id as zero', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 'nope' }] }) // max write (invalid string)
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
  });

  it('returns outdatedOp when insert affects zero rows', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: null }] }) // max write (null)
      .mockResolvedValueOnce({ rowCount: 0 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'outdatedOp' }]
    });
  });

  it('defaults link childId to itemId when childId is omitted', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 0 }] }) // max write
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      buildLinkPushPayload({ childId: undefined }),
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'applied' }]
    });
    expect(mockQuery.mock.calls[5]?.[1]?.[6]).toBe('item-1');
  });

  it('applies encrypted link op via canonical push path', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 0 }] }) // max write
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        clientId: 'desktop',
        operations: [
          {
            opId: 'desktop-link-enc-1',
            opType: 'link_add',
            itemId: 'item-1',
            replicaId: 'desktop',
            writeId: 1,
            occurredAt: '2026-02-14T20:00:00.000Z',
            encryptedPayload: 'base64-ciphertext',
            keyEpoch: 3,
            encryptionNonce: 'base64-nonce',
            encryptionAad: 'base64-aad',
            encryptionSignature: 'base64-signature'
          }
        ]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [
        {
          opId: 'desktop-link-enc-1',
          status: 'applied'
        }
      ]
    });
    expect(mockQuery).toHaveBeenCalledTimes(7);
    expect(mockQuery.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(mockQuery.mock.calls[6]?.[0]).toBe('COMMIT');
  });

  it('returns invalidOp when item is missing or not owned', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-2' }]
      }) // owner lookup
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('persists canonical item payload state for item_upsert operations', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 0 }] }) // max write
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT crdt op
      .mockResolvedValueOnce({}) // UPSERT vfs_item_state
      .mockResolvedValueOnce({}) // vfs_emit_sync_change
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(
      {
        clientId: 'desktop',
        operations: [
          {
            opId: 'desktop-item-upsert-1',
            opType: 'item_upsert',
            itemId: 'item-1',
            replicaId: 'desktop',
            writeId: 1,
            occurredAt: '2026-02-14T20:00:00.000Z',
            encryptedPayload: 'base64-ciphertext',
            keyEpoch: 3,
            encryptionNonce: 'base64-nonce',
            encryptionAad: 'base64-aad',
            encryptionSignature: 'base64-signature'
          }
        ]
      },
      authHeader
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-item-upsert-1', status: 'applied' }]
    });
    expect(mockQuery.mock.calls[6]?.[0]).toContain(
      'INSERT INTO vfs_item_state'
    );
    expect(mockQuery.mock.calls[7]?.[0]).toContain('vfs_emit_sync_change');
  });

  it('rolls back and returns 500 on push processing error', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockRejectedValueOnce(new Error('lock failed')) // advisory lock
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to push CRDT operations' });
    expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    restoreConsole();
  });

  it('still returns 500 when rollback fails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockRejectedValueOnce(new Error('lock failed')) // advisory lock
      .mockRejectedValueOnce(new Error('rollback failed')); // ROLLBACK

    const response = await postCrdtPush(buildValidPushPayload(), authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to push CRDT operations' });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    restoreConsole();
  });
});
