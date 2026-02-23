import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockClientRelease,
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './testSupport.js';

describe('VFS routes (blobs abandon)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('POST /vfs/blobs/stage/:stagingId/abandon', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).post(
        '/v1/vfs/blobs/stage/stage-1/abandon'
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when stagingId is missing', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/%20/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'stagingId is required' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 404 when staged blob is missing', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob staging not found' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 200 when abandon succeeds', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        abandoned: true,
        stagingId: 'stage-1',
        status: 'abandoned'
      });
      expect(mockQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE');
      expect(mockQuery.mock.calls[2]?.[0]).toContain(
        "wrapped_session_key = 'blob-stage:staged'"
      );
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when staged blob belongs to a different user', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-2', status: 'staged' }]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when staged blob is no longer staged', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'attached' }]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer abandonable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when update guardrail detects abandon race', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT
        .mockResolvedValueOnce({ rowCount: 0 }) // guarded UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer abandonable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('rolls back and returns 500 when abandon fails mid-transaction', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT
        .mockRejectedValueOnce(new Error('update failed')) // UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to abandon staged blob' });
      expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });

    it('returns 500 when rollback also fails', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT
        .mockRejectedValueOnce(new Error('update failed')) // UPDATE
        .mockRejectedValueOnce(new Error('rollback failed')); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to abandon staged blob' });
      expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });
  });
});
