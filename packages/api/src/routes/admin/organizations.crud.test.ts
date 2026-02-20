import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { getRootHandler } from './organizations/getRoot.js';

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

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/organizations')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });

    it('returns org-scoped organizations for org admin users', async () => {
      const orgAdminHeader = await createAuthHeader({
        id: 'org-admin-1',
        email: 'org-admin@example.com',
        admin: false
      });
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [{ organization_id: 'org-2' }]
          })
          .mockResolvedValueOnce({
            rows: [
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
        .set('Authorization', orgAdminHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        organizations: [
          {
            id: 'org-2',
            name: 'Beta',
            description: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          }
        ]
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('WHERE id = ANY($1::text[])'),
        [['org-2']]
      );
    });

    it('returns 403 when org admin requests an unauthorized organization', async () => {
      const orgAdminHeader = await createAuthHeader({
        id: 'org-admin-2',
        email: 'org-admin2@example.com',
        admin: false
      });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValueOnce({
          rows: [{ organization_id: 'org-1' }]
        })
      });

      const response = await request(app)
        .get('/v1/admin/organizations?organizationId=org-2')
        .set('Authorization', orgAdminHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('returns 400 for non-string organizationId query', async () => {
      const response = await request(app)
        .get(
          '/v1/admin/organizations?organizationId=org-1&organizationId=org-2'
        )
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'organizationId query must be a string'
      });
    });

    it('supports root admin filtering by organizationId query', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValueOnce({
          rows: [
            {
              id: 'org-1',
              name: 'Alpha',
              description: null,
              created_at: now,
              updated_at: now
            }
          ]
        })
      });

      const response = await request(app)
        .get('/v1/admin/organizations?organizationId=org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.organizations).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ANY($1::text[])'),
        [['org-1']]
      );
    });

    it('returns fallback error message on non-Error organization query failure', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockRejectedValueOnce('database error')
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/organizations')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch organizations' });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('returns 401 when organizations handler is mounted without admin access middleware', async () => {
      const isolatedApp = express();
      isolatedApp.get('/', getRootHandler);

      const response = await request(isolatedApp).get('/');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
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

    it('returns 400 when name is empty', async () => {
      const response = await request(app)
        .post('/v1/admin/organizations')
        .set('Authorization', authHeader)
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Name is required' });
    });

    it('returns 500 when insert returns no rows', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .post('/v1/admin/organizations')
        .set('Authorization', authHeader)
        .send({ name: 'Alpha' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to create organization' });
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
        .post('/v1/admin/organizations')
        .set('Authorization', authHeader)
        .send({ name: 'Alpha' });

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
        .post('/v1/admin/organizations')
        .set('Authorization', authHeader)
        .send({ name: 'Alpha' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
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

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/organizations/org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
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
