import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import {
  mockClientRelease,
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './testSupport.js';

describe('VFS blob stage retry outcomes', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  it('keeps attach retry outcomes deterministic for identical payloads', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN #1
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: 'user-1',
            status: 'staged',
            expires_at: '2099-02-14T11:00:00.000Z'
          }
        ]
      }) // SELECT staging #1
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-02-14T10:10:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      }) // UPDATE #1
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob #1
      .mockResolvedValueOnce({ rows: [{ object_type: 'file' }] }) // SELECT blob #1
      .mockResolvedValueOnce({
        rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
      }) // INSERT ref #1
      .mockResolvedValueOnce({}) // COMMIT #1
      .mockResolvedValueOnce({}) // BEGIN #2
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: 'user-1',
            status: 'attached',
            expires_at: '2099-02-14T11:00:00.000Z'
          }
        ]
      }) // SELECT staging #2
      .mockResolvedValueOnce({}); // ROLLBACK #2

    const first = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1', relationKind: 'file' });

    const second = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1', relationKind: 'file' });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      attached: true,
      stagingId: 'stage-1',
      blobId: 'blob-1',
      itemId: 'item-1',
      relationKind: 'file',
      refId: 'ref-1',
      attachedAt: '2026-02-14T10:10:00.000Z'
    });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({
      error: 'Blob staging is no longer attachable'
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(2);
  });

  it('fails closed on attach retry when guarded update detects race', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN #1
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: 'user-1',
            status: 'staged',
            expires_at: '2099-02-14T11:00:00.000Z'
          }
        ]
      }) // SELECT staging #1
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-02-14T10:10:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      }) // UPDATE #1
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob #1
      .mockResolvedValueOnce({ rows: [{ object_type: 'file' }] }) // SELECT blob #1
      .mockResolvedValueOnce({
        rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
      }) // INSERT ref #1
      .mockResolvedValueOnce({}) // COMMIT #1
      .mockResolvedValueOnce({}) // BEGIN #2
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: 'user-1',
            status: 'staged',
            expires_at: '2099-02-14T11:00:00.000Z'
          }
        ]
      }) // SELECT staging #2
      .mockResolvedValueOnce({ rows: [] }) // guarded UPDATE #2
      .mockResolvedValueOnce({}); // ROLLBACK #2

    const first = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1', relationKind: 'file' });

    const second = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1', relationKind: 'file' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({
      error: 'Blob staging is no longer attachable'
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(2);
  });

  it('keeps abandon retry outcomes deterministic for identical payloads', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN #1
      .mockResolvedValueOnce({
        rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
      }) // SELECT #1
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE #1
      .mockResolvedValueOnce({}) // DELETE staged chunk rows #1
      .mockResolvedValueOnce({}) // COMMIT #1
      .mockResolvedValueOnce({}) // BEGIN #2
      .mockResolvedValueOnce({
        rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'abandoned' }]
      }) // SELECT #2
      .mockResolvedValueOnce({}); // ROLLBACK #2

    const first = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/abandon')
      .set('Authorization', authHeader)
      .send({});

    const second = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/abandon')
      .set('Authorization', authHeader)
      .send({});

    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      abandoned: true,
      stagingId: 'stage-1',
      status: 'abandoned'
    });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({
      error: 'Blob staging is no longer abandonable'
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(2);
  });

  it('fails closed on abandon retry when guarded update detects race', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN #1
      .mockResolvedValueOnce({
        rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
      }) // SELECT #1
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE #1
      .mockResolvedValueOnce({}) // DELETE staged chunk rows #1
      .mockResolvedValueOnce({}) // COMMIT #1
      .mockResolvedValueOnce({}) // BEGIN #2
      .mockResolvedValueOnce({
        rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
      }) // SELECT #2
      .mockResolvedValueOnce({ rowCount: 0 }) // guarded UPDATE #2
      .mockResolvedValueOnce({}); // ROLLBACK #2

    const first = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/abandon')
      .set('Authorization', authHeader)
      .send({});

    const second = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/abandon')
      .set('Authorization', authHeader)
      .send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({
      error: 'Blob staging is no longer abandonable'
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(2);
  });
});
