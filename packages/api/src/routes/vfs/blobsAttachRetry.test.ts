import './testSupport.js';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
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

describe('VFS routes (blobs attach retry contracts)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  it('retries attach with identical payload and succeeds once reconcile visibility catches up', async () => {
    const authHeader = await createAuthHeader();
    const requiredCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T10:00:02.000Z',
      changeId: 'desktop-2'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN (attempt 1)
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
      }) // SELECT staging (attempt 1)
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T10:00:01.000Z',
            last_reconciled_change_id: 'desktop-1',
            last_reconciled_write_ids: { desktop: 1 }
          }
        ]
      }) // SELECT reconcile behind (attempt 1)
      .mockResolvedValueOnce({}) // ROLLBACK (attempt 1)
      .mockResolvedValueOnce({}) // BEGIN (attempt 2)
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
      }) // SELECT staging (attempt 2)
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T10:00:03.000Z',
            last_reconciled_change_id: 'desktop-3',
            last_reconciled_write_ids: { desktop: 3 }
          }
        ]
      }) // SELECT reconcile ahead (attempt 2)
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-02-14T10:10:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      }) // UPDATE (attempt 2)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob registry
      .mockResolvedValueOnce({ rows: [{ object_type: 'file' }] }) // SELECT blob registry
      .mockResolvedValueOnce({
        rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
      }) // INSERT ref
      .mockResolvedValueOnce({}); // COMMIT

    const payload = {
      itemId: 'item-1',
      relationKind: 'file',
      clientId: 'desktop',
      requiredCursor,
      requiredLastReconciledWriteIds: {
        desktop: 2
      }
    };

    const firstResponse = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send(payload);

    const secondResponse = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send(payload);

    expect(firstResponse.status).toBe(409);
    expect(firstResponse.body).toEqual({
      error: 'Client reconcile state is behind required visibility'
    });
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toEqual({
      attached: true,
      stagingId: 'stage-1',
      blobId: 'blob-1',
      itemId: 'item-1',
      relationKind: 'file',
      refId: 'ref-1',
      attachedAt: '2026-02-14T10:10:00.000Z'
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(2);
  });

  it('returns 409 for repeated attach retry after prior attach committed', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN (attempt 1)
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
      }) // SELECT staging (attempt 1)
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-02-14T10:10:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      }) // UPDATE (attempt 1)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob registry
      .mockResolvedValueOnce({ rows: [{ object_type: 'file' }] }) // SELECT blob registry
      .mockResolvedValueOnce({
        rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
      }) // INSERT ref
      .mockResolvedValueOnce({}) // COMMIT (attempt 1)
      .mockResolvedValueOnce({}) // BEGIN (attempt 2)
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
      }) // SELECT staging (attempt 2)
      .mockResolvedValueOnce({}); // ROLLBACK (attempt 2)

    const payload = { itemId: 'item-1', relationKind: 'file' };

    const firstResponse = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send(payload);

    const secondResponse = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send(payload);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body).toEqual({
      error: 'Blob staging is no longer attachable'
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(2);
  });
});
