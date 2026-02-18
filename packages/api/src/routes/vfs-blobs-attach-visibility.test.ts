import './vfs-test-support.js';
import { encodeVfsSyncCursor } from '@tearleads/sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';
import {
  mockClientRelease,
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfs-test-support.js';

describe('VFS routes (blobs attach visibility)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  it('returns 409 when reconcile cursor shares timestamp but has lower changeId', async () => {
    const authHeader = await createAuthHeader();
    const requiredCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T10:00:02.000Z',
      changeId: 'desktop-3'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
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
      }) // SELECT staging
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T10:00:02.000Z',
            last_reconciled_change_id: 'desktop-2',
            last_reconciled_write_ids: { desktop: 9 }
          }
        ]
      }) // SELECT reconcile
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-1',
        clientId: 'desktop',
        requiredCursor,
        requiredLastReconciledWriteIds: { desktop: 2 }
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Client reconcile state is behind required visibility'
    });
    expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 200 when reconcile cursor shares timestamp but has higher changeId', async () => {
    const authHeader = await createAuthHeader();
    const requiredCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T10:00:02.000Z',
      changeId: 'desktop-3'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
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
      }) // SELECT staging
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T10:00:02.000Z',
            last_reconciled_change_id: 'desktop-4',
            last_reconciled_write_ids: { desktop: 9 }
          }
        ]
      }) // SELECT reconcile
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-02-14T10:10:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      }) // UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob into vfs_registry
      .mockResolvedValueOnce({ rows: [{ object_type: 'blob' }] }) // SELECT blob registry row
      .mockResolvedValueOnce({
        rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
      }) // INSERT blob link
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-1',
        relationKind: 'file',
        clientId: 'desktop',
        requiredCursor,
        requiredLastReconciledWriteIds: { desktop: 2 }
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      attached: true,
      stagingId: 'stage-1',
      blobId: 'blob-1',
      itemId: 'item-1',
      relationKind: 'file',
      refId: 'ref-1',
      attachedAt: '2026-02-14T10:10:00.000Z'
    });
    expect(mockQuery.mock.calls[7]?.[0]).toBe('COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when required replica write ids are missing from reconcile state', async () => {
    const authHeader = await createAuthHeader();
    const requiredCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T10:00:02.000Z',
      changeId: 'desktop-2'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
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
      }) // SELECT staging
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T10:00:03.000Z',
            last_reconciled_change_id: 'desktop-4',
            last_reconciled_write_ids: { desktop: 9 }
          }
        ]
      }) // SELECT reconcile
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-1',
        clientId: 'desktop',
        requiredCursor,
        requiredLastReconciledWriteIds: {
          desktop: 2,
          mobile: 1
        }
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Client reconcile state is behind required visibility'
    });
    expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when staged blob status metadata is invalid', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: 'user-1',
            status: 'invalid',
            expires_at: '2099-02-14T11:00:00.000Z'
          }
        ]
      }) // SELECT
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Blob staging is no longer attachable'
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when staged blob metadata has an invalid expiresAt timestamp', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: 'user-1',
            status: 'staged',
            expires_at: 'not-a-timestamp'
          }
        ]
      }) // SELECT
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
    expect(mockQuery.mock.calls[2]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when staged blob metadata has an invalid Date expiresAt', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: 'user-1',
            status: 'staged',
            expires_at: new Date('not-a-date')
          }
        ]
      }) // SELECT
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
    expect(mockQuery.mock.calls.some((call) => call[0] === 'ROLLBACK')).toBe(
      true
    );
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    restoreConsole();
  });

  it('returns 500 when reconcile state uses legacy array write-id payloads', async () => {
    const authHeader = await createAuthHeader();
    const requiredCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T10:00:02.000Z',
      changeId: 'desktop-2'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
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
      }) // SELECT staging
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T10:00:03.000Z',
            last_reconciled_change_id: 'desktop-3',
            last_reconciled_write_ids: [['desktop', 3]]
          }
        ]
      }) // SELECT reconcile
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-1',
        clientId: 'desktop',
        requiredCursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
    expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when reconcile state write-id payload uses legacy string shape', async () => {
    const authHeader = await createAuthHeader();
    const requiredCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T10:00:02.000Z',
      changeId: 'desktop-2'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
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
      }) // SELECT staging
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T10:00:03.000Z',
            last_reconciled_change_id: 'desktop-3',
            last_reconciled_write_ids: 'desktop=3'
          }
        ]
      }) // SELECT reconcile
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-1',
        clientId: 'desktop',
        requiredCursor
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
    expect(mockQuery.mock.calls.some((call) => call[0] === 'ROLLBACK')).toBe(
      true
    );
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
