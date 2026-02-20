import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { getRootHandler } from './groups/getRoot.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: vi.fn()
}));

describe('admin groups routes - CRUD', () => {
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

  describe('GET /v1/admin/groups', () => {
    it('returns list of groups with member counts', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({
          rows: [
            {
              id: 'group-1',
              organization_id: 'org-1',
              name: 'Admins',
              description: 'Admin users',
              created_at: now,
              updated_at: now,
              member_count: '3'
            },
            {
              id: 'group-2',
              organization_id: 'org-2',
              name: 'Users',
              description: null,
              created_at: now,
              updated_at: now,
              member_count: '10'
            }
          ]
        })
      });

      const response = await request(app)
        .get('/v1/admin/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(2);
      expect(response.body.groups[0]).toEqual({
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Admins',
        description: 'Admin users',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        memberCount: 3
      });
      expect(response.body.groups[1].description).toBeNull();
      expect(response.body.groups[1].memberCount).toBe(10);
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('connection failed'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'connection failed' });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('returns org-scoped groups for org admin users', async () => {
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
                id: 'group-2',
                organization_id: 'org-2',
                name: 'Scoped Group',
                description: null,
                created_at: now,
                updated_at: now,
                member_count: '1'
              }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/groups')
        .set('Authorization', orgAdminHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        groups: [
          {
            id: 'group-2',
            organizationId: 'org-2',
            name: 'Scoped Group',
            description: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            memberCount: 1
          }
        ]
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('WHERE g.organization_id = ANY($1::text[])'),
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
        .get('/v1/admin/groups?organizationId=org-2')
        .set('Authorization', orgAdminHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('returns 400 for non-string organizationId query', async () => {
      const response = await request(app)
        .get('/v1/admin/groups?organizationId=org-1&organizationId=org-2')
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
              id: 'group-1',
              organization_id: 'org-1',
              name: 'Scoped',
              description: null,
              created_at: now,
              updated_at: now,
              member_count: '2'
            }
          ]
        })
      });

      const response = await request(app)
        .get('/v1/admin/groups?organizationId=org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE g.organization_id = ANY($1::text[])'),
        [['org-1']]
      );
    });

    it('returns fallback error message on non-Error group query failure', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockRejectedValueOnce('connection failed')
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch groups' });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('returns 401 when groups handler is mounted without admin access middleware', async () => {
      const isolatedApp = express();
      isolatedApp.get('/', getRootHandler);

      const response = await request(isolatedApp).get('/');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });
  });

  describe('POST /v1/admin/groups', () => {
    it('creates a group successfully', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'new-group-id',
                organization_id: 'org-1',
                name: 'New Group',
                description: 'A new group',
                created_at: now,
                updated_at: now
              }
            ]
          })
      });

      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({
          name: 'New Group',
          description: 'A new group',
          organizationId: 'org-1'
        });

      expect(response.status).toBe(201);
      expect(response.body.group).toEqual({
        id: 'new-group-id',
        organizationId: 'org-1',
        name: 'New Group',
        description: 'A new group',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
    });

    it('creates a group without description', async () => {
      const now = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'new-group-id',
                organization_id: 'org-1',
                name: 'New Group',
                description: null,
                created_at: now,
                updated_at: now
              }
            ]
          })
      });

      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({ name: 'New Group', organizationId: 'org-1' });

      expect(response.status).toBe(201);
      expect(response.body.group.description).toBeNull();
      expect(response.body.group.organizationId).toBe('org-1');
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Name is required' });
    });

    it('returns 400 when name is empty', async () => {
      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({ name: '   ', organizationId: 'org-1' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Name is required' });
    });

    it('returns 400 when organization ID is missing', async () => {
      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({ name: 'New Group' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Organization ID is required' });
    });

    it('returns 400 when organization ID is empty', async () => {
      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({ name: 'New Group', organizationId: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Organization ID is required' });
    });

    it('returns 404 when organization does not exist', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValueOnce({ rows: [] })
      });

      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({ name: 'New Group', organizationId: 'missing-org' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Organization not found' });
    });

    it('returns 409 when name already exists', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockRejectedValueOnce(
            new Error('duplicate key value violates unique constraint')
          )
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({ name: 'Existing Group', organizationId: 'org-1' });

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
        .post('/v1/admin/groups')
        .set('Authorization', authHeader)
        .send({ name: 'Test Group', organizationId: 'org-1' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });

  describe('GET /v1/admin/groups/:id', () => {
    it('returns group details with members', async () => {
      const now = new Date();
      const joinedAt = new Date('2024-01-01');
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'group-1',
                organization_id: 'org-1',
                name: 'Test Group',
                description: 'Test description',
                created_at: now,
                updated_at: now
              }
            ]
          })
          .mockResolvedValueOnce({
            rows: [
              {
                user_id: 'user-1',
                email: 'user1@test.com',
                joined_at: joinedAt
              },
              {
                user_id: 'user-2',
                email: 'user2@test.com',
                joined_at: joinedAt
              }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.group).toEqual({
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: 'Test description',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
      expect(response.body.members).toHaveLength(2);
      expect(response.body.members[0]).toEqual({
        userId: 'user-1',
        email: 'user1@test.com',
        joinedAt: joinedAt.toISOString()
      });
    });

    it('returns 404 when group not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/groups/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Group not found' });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });
});
