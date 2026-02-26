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

describe('VFS routes (blobs attach existing-link metadata)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  it('returns 500 when existing blob link metadata has no relation kind', async () => {
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
      }) // SELECT staging
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-02-14T10:10:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      }) // UPDATE staging link
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob registry
      .mockResolvedValueOnce({ rows: [{ object_type: 'file' }] }) // SELECT blob registry
      .mockResolvedValueOnce({ rows: [] }) // INSERT blob link conflict
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'existing-ref-1',
            created_at: '2026-02-14T10:10:01.000Z',
            wrapped_session_key: 'bad-session-key',
            visible_children: {}
          }
        ]
      }) // SELECT existing link
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/blobs/stage/stage-1/attach')
      .set('Authorization', authHeader)
      .send({ itemId: 'item-1', relationKind: 'file' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
    expect(mockQuery.mock.calls[7]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('uses wrapped_session_key relation kind when visible_children metadata is missing', async () => {
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
      }) // SELECT staging
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-02-14T10:10:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      }) // UPDATE staging link
      .mockResolvedValueOnce({ rowCount: 1 }) // UPSERT blob registry
      .mockResolvedValueOnce({ rows: [{ object_type: 'file' }] }) // SELECT blob registry
      .mockResolvedValueOnce({ rows: [] }) // INSERT blob link conflict
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'existing-ref-1',
            created_at: '2026-02-14T10:10:01.000Z',
            wrapped_session_key: 'blob-link:file',
            visible_children: {}
          }
        ]
      }) // SELECT existing link
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
    expect(mockQuery.mock.calls[7]?.[0]).toBe('COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
