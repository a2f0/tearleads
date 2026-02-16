import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildLinkPushPayload,
  buildValidPushPayload,
  mockClientRelease,
  mockQuery,
  setupCrdtPushRouteTestEnv,
  teardownCrdtPushRouteTestEnv
} from './vfs-crdt-push-test-support.js';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';

async function postCrdtPush(authHeader: string, payload: unknown) {
  return request(app)
    .post('/v1/vfs/crdt/push')
    .set('Authorization', authHeader)
    .send(payload);
}

describe('VFS CRDT push route validation', () => {
  beforeEach(() => {
    setupCrdtPushRouteTestEnv();
  });

  afterEach(() => {
    teardownCrdtPushRouteTestEnv();
  });

  it('returns 401 when not authenticated', async () => {
    const response = await request(app).post('/v1/vfs/crdt/push').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when payload is invalid', async () => {
    const authHeader = await createAuthHeader();
    const response = await postCrdtPush(authHeader, {
      clientId: 'bad:client',
      operations: 'not-an-array'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('clientId');
  });

  it('returns 400 when payload is not an object', async () => {
    const authHeader = await createAuthHeader();
    const response = await postCrdtPush(authHeader, 'invalid-payload');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId and operations are required'
    });
  });

  it('returns 400 when operations is not an array', async () => {
    const authHeader = await createAuthHeader();
    const response = await postCrdtPush(authHeader, {
      clientId: 'desktop',
      operations: 'bad-shape'
    });

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

    const response = await postCrdtPush(authHeader, {
      clientId: 'desktop',
      operations
    });

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

    const response = await postCrdtPush(authHeader, {
      clientId: 'desktop',
      operations: [
        {
          opId: 'bad-op',
          opType: 'acl_add'
        }
      ]
    });

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

    const response = await postCrdtPush(authHeader, {
      clientId: 'desktop',
      operations: [null]
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'invalid-0', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for replica mismatch', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await postCrdtPush(authHeader, {
      ...buildValidPushPayload(),
      operations: [
        {
          ...buildValidPushPayload().operations[0],
          replicaId: 'mobile'
        }
      ]
    });

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

    const response = await postCrdtPush(authHeader, {
      ...buildValidPushPayload(),
      operations: [
        {
          ...buildValidPushPayload().operations[0],
          principalType: 'invalid-type'
        }
      ]
    });

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

    const response = await postCrdtPush(authHeader, {
      ...buildValidPushPayload(),
      operations: [
        {
          ...buildValidPushPayload().operations[0],
          accessLevel: 'owner'
        }
      ]
    });

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
      authHeader,
      buildLinkPushPayload({ parentId: '   ' })
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
      authHeader,
      buildLinkPushPayload({ childId: 'item-2' })
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
      authHeader,
      buildLinkPushPayload({ parentId: 'item-1' })
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'invalidOp' }]
    });
  });
});
