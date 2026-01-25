import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('admin organizations routes', () => {
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

  describe('GET /v1/admin/organizations', () => {
    it('returns list of organizations', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'org-1',
              name: 'Alpha',
              description: 'First org',
              created_at: now,
              updated_at: now
            },
            {
              id: 'org-2',
              name: 'Beta',
              description: null,
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .get('/v1/admin/organizations')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.organizations).toHaveLength(2);
      expect(response.body.organizations[0]).toEqual({
        id: 'org-1',
        name: 'Alpha',
        description: 'First org',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
      expect(response.body.organizations[1].description).toBeNull();
    });
  });

  describe('POST /v1/admin/organizations', () => {
    it('creates an organization successfully', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'org-1',
              name: 'Alpha',
              description: 'First org',
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .post('/v1/admin/organizations')
        .set('Authorization', authHeader)
        .send({ name: 'Alpha', description: 'First org' });

      expect(response.status).toBe(201);
      expect(response.body.organization).toEqual({
        id: 'org-1',
        name: 'Alpha',
        description: 'First org',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app)
        .post('/v1/admin/organizations')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Name is required' });
    });
  });

  describe('GET /v1/admin/organizations/:id', () => {
    it('returns organization details', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'org-1',
              name: 'Alpha',
              description: 'First org',
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        organization: {
          id: 'org-1',
          name: 'Alpha',
          description: 'First org',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        }
      });
    });

    it('returns 404 when organization not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/missing')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Organization not found' });
    });
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
  });

  describe('DELETE /v1/admin/organizations/:id', () => {
    it('deletes an organization', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rowCount: 1 })
      });

      const response = await request(app)
        .delete('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
    });
  });
});
