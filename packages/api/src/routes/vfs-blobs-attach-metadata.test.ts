import './vfs-test-support.js';
import { encodeVfsSyncCursor } from '@tearleads/sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import {
  mockClientRelease,
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfs-test-support.js';

describe('VFS routes (blobs attach metadata guardrails)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  it('returns 500 when staged blob metadata has null owner', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: 'blob-1',
            staged_by: null,
            status: 'staged',
            expires_at: '2099-02-14T11:00:00.000Z'
          }
        ]
      }) // SELECT staging
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

  it('returns 500 when staged blob metadata has blank blob id', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'stage-1',
            blob_id: ' ',
            staged_by: 'user-1',
            status: 'staged',
            expires_at: '2099-02-14T11:00:00.000Z'
          }
        ]
      }) // SELECT staging
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

  it('returns 500 when reconcile state has invalid last_reconciled_at timestamp', async () => {
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
            last_reconciled_at: 'not-a-date',
            last_reconciled_change_id: 'desktop-3',
            last_reconciled_write_ids: { desktop: 3 }
          }
        ]
      }) // SELECT reconcile
      .mockResolvedValueOnce({}); // ROLLBACK

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

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
    expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when reconcile state has blank last_reconciled_change_id', async () => {
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
            last_reconciled_change_id: ' ',
            last_reconciled_write_ids: { desktop: 3 }
          }
        ]
      }) // SELECT reconcile
      .mockResolvedValueOnce({}); // ROLLBACK

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

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
    expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
