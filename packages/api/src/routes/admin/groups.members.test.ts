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

describe('admin groups routes - members', () => {
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

  describe('GET /v1/admin/groups/:id/members', () => {
    it('returns group members', async () => {
      const joinedAt = new Date('2024-01-01');
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
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
        query: mockQuery.mockResolvedValue({ rows: [] })
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
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rowCount: 1 })
      });

      const response = await request(app)
        .delete('/v1/admin/groups/group-1/members/user-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ removed: true });
    });

    it('returns removed: false when member not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
          .mockResolvedValueOnce({ rowCount: 0 })
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
