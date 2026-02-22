import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('admin organizations routes - CRUD', () => {

  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader({
      id: 'admin-1',
      email: 'admin@example.com',
      admin: true
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('PUT /v1/admin/organizations/:id', () => {
    it('updates an organization', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'org-1',
              name: 'Alpha Updated',
              description: 'Updated',
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .put('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader)
        .send({ name: 'Alpha Updated', description: 'Updated' });

      expect(response.status).toBe(200);
      expect(response.body.organization.name).toBe('Alpha Updated');
    });

    it('updates description only', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'org-1',
              name: 'Alpha',
              description: 'Updated',
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .put('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader)
        .send({ description: 'Updated' });

      expect(response.status).toBe(200);
      expect(response.body.organization.description).toBe('Updated');
    });

    it('returns 400 when name is empty', async () => {
      const response = await request(app)
        .put('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader)
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Name cannot be empty' });
    });

    it('returns 400 when no fields to update', async () => {
      const response = await request(app)
        .put('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'No fields to update' });
    });

    it('returns 404 when organization not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .put('/v1/admin/organizations/missing')
        .set('Authorization', authHeader)
        .send({ name: 'Updated' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Organization not found' });
    });

    it('returns 409 when name already exists', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockRejectedValue(
          new Error('duplicate key value violates unique constraint')
        )
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .put('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader)
        .send({ name: 'Alpha Updated' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Organization name already exists'
      });
      consoleError.mockRestore();
    });

    it('returns 500 on database error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .put('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader)
        .send({ name: 'Alpha Updated' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });

  describe('DELETE /v1/admin/organizations/:id', () => {
    it('deletes an organization', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ is_personal: false }] })
          .mockResolvedValueOnce({ rowCount: 1 })
      });

      const response = await request(app)
        .delete('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
    });

    it('returns deleted: false when organization not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .delete('/v1/admin/organizations/missing')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: false });
    });

    it('returns 400 when deleting a personal organization', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [{ is_personal: true }]
        })
      });

      const response = await request(app)
        .delete('/v1/admin/organizations/personal-org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Personal organizations cannot be deleted'
      });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .delete('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });
});
