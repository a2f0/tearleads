import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: vi.fn()
}));

describe('admin groups routes - update and delete', () => {
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

  describe('PUT /v1/admin/groups/:id', () => {
    it('updates group name and description', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'group-1',
              organization_id: 'org-1',
              name: 'Updated Name',
              description: 'Updated description',
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ name: 'Updated Name', description: 'Updated description' });

      expect(response.status).toBe(200);
      expect(response.body.group.name).toBe('Updated Name');
      expect(response.body.group.description).toBe('Updated description');
      expect(response.body.group.organizationId).toBe('org-1');
    });

    it('updates only name', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'group-1',
              organization_id: 'org-1',
              name: 'New Name',
              description: 'Old description',
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ name: 'New Name' });

      expect(response.status).toBe(200);
      expect(response.body.group.name).toBe('New Name');
      expect(response.body.group.organizationId).toBe('org-1');
    });

    it('updates organization ID', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'org-2' }] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'group-1',
                organization_id: 'org-2',
                name: 'Group Name',
                description: 'Desc',
                created_at: now,
                updated_at: now
              }
            ]
          })
      });

      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ organizationId: 'org-2' });

      expect(response.status).toBe(200);
      expect(response.body.group.organizationId).toBe('org-2');
    });

    it('returns 400 when name is empty string', async () => {
      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Name cannot be empty' });
    });

    it('returns 400 when organization ID is empty', async () => {
      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ organizationId: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Organization ID cannot be empty'
      });
    });

    it('returns 400 when no fields to update', async () => {
      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'No fields to update' });
    });

    it('returns 404 when group not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .put('/v1/admin/groups/nonexistent')
        .set('Authorization', authHeader)
        .send({ name: 'Test' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Group not found' });
    });

    it('returns 404 when organization not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rows: [] })
      });

      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ organizationId: 'missing-org' });

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
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ name: 'Existing Name' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Group name already exists' });
      consoleError.mockRestore();
    });

    it('returns 500 on database error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ name: 'Test' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });

  describe('DELETE /v1/admin/groups/:id', () => {
    it('deletes a group successfully', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rowCount: 1 })
      });

      const response = await request(app)
        .delete('/v1/admin/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
    });

    it('returns deleted: false when group not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rowCount: 0 })
      });

      const response = await request(app)
        .delete('/v1/admin/groups/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: false });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .delete('/v1/admin/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });
});
