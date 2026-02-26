import './testSupport.js';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import {
  mockClientRelease,
  mockPoolConnect,
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './testSupport.js';

describe('VFS routes (blobs attach)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('POST /vfs/blobs/stage/:stagingId/attach', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when staged blob is missing', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob staging not found' });
      expect(mockQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when itemId is missing', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'itemId is required' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 200 when attach succeeds with transaction ordering guardrails', async () => {
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
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({
          rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
        }) // INSERT blob link
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

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
      expect(mockQuery.mock.calls[0]?.[0]).toBe('BEGIN');
      expect(mockQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE');
      expect(mockQuery.mock.calls[2]?.[0]).toContain(
        "wrapped_session_key = 'blob-stage:staged'"
      );
      expect(mockQuery.mock.calls[5]?.[0]).toContain('INSERT INTO vfs_links');
      expect(mockQuery.mock.calls[6]?.[0]).toBe('COMMIT');
      expect(mockPoolConnect).toHaveBeenCalledTimes(1);
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('falls back to existing blob link when insert conflicts', async () => {
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
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT ... FOR UPDATE (staging)
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT ref conflict
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'existing-ref-1',
              created_at: '2026-02-14T10:10:01.000Z',
              wrapped_session_key: 'blob-link:file',
              visible_children: {
                relationKind: 'file',
                attachedBy: 'user-1'
              }
            }
          ]
        }) // SELECT existing ref
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        attached: true,
        stagingId: 'stage-1',
        blobId: 'blob-1',
        itemId: 'item-1',
        relationKind: 'file',
        refId: 'existing-ref-1',
        attachedAt: '2026-02-14T10:10:01.000Z'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 200 when reconcile visibility guardrails are satisfied', async () => {
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
        }) // SELECT ... FOR UPDATE (staging)
        .mockResolvedValueOnce({
          rows: [
            {
              last_reconciled_at: '2026-02-14T10:00:03.000Z',
              last_reconciled_change_id: 'desktop-3',
              last_reconciled_write_ids: {
                desktop: 3,
                mobile: 1
              }
            }
          ]
        }) // SELECT ... FOR UPDATE (reconcile)
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'file' }]
        }) // SELECT blob registry row
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
          requiredLastReconciledWriteIds: {
            desktop: 2
          }
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
      expect(mockQuery.mock.calls[2]?.[0]).toContain(
        'FROM vfs_sync_client_state'
      );
      expect(mockQuery.mock.calls[2]?.[1]).toEqual(['user-1', 'crdt:desktop']);
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when guardrails are provided without clientId', async () => {
      const authHeader = await createAuthHeader();
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-14T10:00:02.000Z',
        changeId: 'desktop-2'
      });

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          requiredCursor
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'clientId is required when reconcile guardrails are provided'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 400 when guardrails are provided without requiredCursor', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'requiredCursor is required when reconcile guardrails are provided'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 409 when reconcile visibility is behind requested checkpoint', async () => {
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
              last_reconciled_at: '2026-02-14T10:00:01.000Z',
              last_reconciled_change_id: 'desktop-1',
              last_reconciled_write_ids: {
                desktop: 1
              }
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
            desktop: 2
          }
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Client reconcile state is behind required visibility'
      });
      expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when requiredCursor is invalid for visibility guardrails', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop',
          requiredCursor: 'not-a-cursor'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid requiredCursor' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 400 when requiredLastReconciledWriteIds is invalid', async () => {
      const authHeader = await createAuthHeader();
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-14T10:00:02.000Z',
        changeId: 'desktop-2'
      });

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop',
          requiredCursor,
          requiredLastReconciledWriteIds: {
            desktop: 0
          }
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 500 when reconcile state row contains invalid write ids', async () => {
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
              last_reconciled_write_ids: {
                desktop: 'oops'
              }
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
  });
});
