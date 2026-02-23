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

describe('VFS routes (blobs attach visibility reconcile metadata)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  it.each([
    {
      description: 'an invalid last_reconciled_at timestamp',
      reconcileRow: {
        last_reconciled_at: 'not-a-timestamp',
        last_reconciled_change_id: 'desktop-3',
        last_reconciled_write_ids: { desktop: 3 }
      }
    },
    {
      description: 'a missing last_reconciled_change_id',
      reconcileRow: {
        last_reconciled_at: '2026-02-14T10:00:03.000Z',
        last_reconciled_change_id: null,
        last_reconciled_write_ids: { desktop: 3 }
      }
    }
  ])('returns 500 when reconcile state has $description', async ({
    reconcileRow
  }) => {
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
        rows: [reconcileRow]
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
