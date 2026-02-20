import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('admin organizations routes - relations', () => {
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

  describe('GET /v1/admin/organizations/:id/users', () => {
    it('returns list of organization users', async () => {
      const joinedAt = new Date();
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({
            rows: [
              { id: 'user-1', email: 'alice@example.com', joined_at: joinedAt },
              { id: 'user-2', email: 'bob@example.com', joined_at: joinedAt }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/org-1/users')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(2);
      expect(response.body.users[0]).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        joinedAt: joinedAt.toISOString()
      });
    });

    it('returns empty list when no users', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/org-1/users')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(0);
    });

    it('returns 404 when organization not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/missing/users')
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
        .get('/v1/admin/organizations/org-1/users')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });

  describe('GET /v1/admin/organizations/:id/groups', () => {
    it('returns list of organization groups', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'group-1',
                name: 'Admins',
                description: 'Admin group',
                member_count: 3
              },
              {
                id: 'group-2',
                name: 'Users',
                description: null,
                member_count: 10
              }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/org-1/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(2);
      expect(response.body.groups[0]).toEqual({
        id: 'group-1',
        name: 'Admins',
        description: 'Admin group',
        memberCount: 3
      });
      expect(response.body.groups[1]).toEqual({
        id: 'group-2',
        name: 'Users',
        description: null,
        memberCount: 10
      });
    });

    it('returns empty list when no groups', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/org-1/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(0);
    });

    it('returns 404 when organization not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/organizations/missing/groups')
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
        .get('/v1/admin/organizations/org-1/groups')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      consoleError.mockRestore();
    });
  });
});
