import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: vi.fn()
}));

describe('admin groups routes', () => {
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

    it('returns 400 when name is empty string', async () => {
      const response = await request(app)
        .put('/v1/admin/groups/group-1')
        .set('Authorization', authHeader)
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Name cannot be empty' });
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
        query: mockQuery.mockResolvedValue({ rowCount: 1 })
      });

      const response = await request(app)
        .delete('/v1/admin/groups/group-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });
    });

    it('returns deleted: false when group not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rowCount: 0 })
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

  describe('GET /v1/admin/groups/:id/members', () => {
    it('returns group members', async () => {
      const joinedAt = new Date('2024-01-01');
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockResolvedValueOnce({
            rows: [
              {
                user_id: 'user-1',
                email: 'user1@test.com',
                joined_at: joinedAt
              }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/groups/group-1/members')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.members).toHaveLength(1);
      expect(response.body.members[0]).toEqual({
        userId: 'user-1',
        email: 'user1@test.com',
        joinedAt: joinedAt.toISOString()
      });
    });

    it('returns 404 when group not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rowCount: 0 })
      });

      const response = await request(app)
        .get('/v1/admin/groups/nonexistent/members')
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
        .get('/v1/admin/groups/group-1/members')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });

  describe('POST /v1/admin/groups/:id/members', () => {
    it('adds a member successfully', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockResolvedValueOnce({ rowCount: 1 })
      });

      const response = await request(app)
        .post('/v1/admin/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({ userId: 'user-1' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ added: true });
    });

    it('returns 400 when userId is missing', async () => {
      const response = await request(app)
        .post('/v1/admin/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'userId is required' });
    });

    it('returns 404 when group not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .post('/v1/admin/groups/nonexistent/members')
        .set('Authorization', authHeader)
        .send({ userId: 'user-1' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Group not found' });
    });

    it('returns 404 when user not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rowCount: 0 })
      });

      const response = await request(app)
        .post('/v1/admin/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({ userId: 'nonexistent' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
    });

    it('returns 409 when user already a member', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockRejectedValueOnce(
            new Error('duplicate key value violates unique constraint')
          )
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .post('/v1/admin/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({ userId: 'user-1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'User is already a member of this group'
      });
      consoleError.mockRestore();
    });

    it('returns 500 on database error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .post('/v1/admin/groups/group-1/members')
        .set('Authorization', authHeader)
        .send({ userId: 'user-1' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });

  describe('DELETE /v1/admin/groups/:id/members/:userId', () => {
    it('removes a member successfully', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rowCount: 1 })
      });

      const response = await request(app)
        .delete('/v1/admin/groups/group-1/members/user-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ removed: true });
    });

    it('returns removed: false when member not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rowCount: 0 })
      });

      const response = await request(app)
        .delete('/v1/admin/groups/group-1/members/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ removed: false });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('database error'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .delete('/v1/admin/groups/group-1/members/user-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });
});
