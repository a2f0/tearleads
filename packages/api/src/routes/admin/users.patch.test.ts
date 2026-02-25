import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

vi.mock('../../lib/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sessions.js')>();
  return {
    ...actual,
    getLatestLastActiveByUserIds: vi.fn().mockResolvedValue({}),
    deleteAllSessionsForUser: vi.fn().mockResolvedValue(0)
  };
});

describe('admin users routes - PATCH validation', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user@example.com',
      admin: true
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('PATCH /v1/admin/users/:id - basic updates', () => {
    it('updates a user', async () => {
      mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
      mockQuery.mockImplementation((query: string) => {
        const trimmedQuery = query.trimStart();
        if (query === 'BEGIN' || query === 'COMMIT') {
          return Promise.resolve({ rows: [] });
        }
        if (trimmedQuery.startsWith('UPDATE users')) {
          return Promise.resolve({
            rows: [
              {
                id: 'user-1',
                email: 'updated@example.com',
                email_confirmed: true,
                admin: true,
                disabled: false,
                disabled_at: null,
                disabled_by: null,
                marked_for_deletion_at: null,
                marked_for_deletion_by: null
              }
            ]
          });
        }
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ email: 'updated@example.com', admin: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: {
          id: 'user-1',
          email: 'updated@example.com',
          emailConfirmed: true,
          admin: true,
          disabled: false,
          disabledAt: null,
          disabledBy: null,
          markedForDeletionAt: null,
          markedForDeletionBy: null,
          organizationIds: [],
          createdAt: null,
          lastActiveAt: null,
          accounting: {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            requestCount: 0,
            lastUsedAt: null
          }
        }
      });
      expect(mockQuery).toHaveBeenCalled();
    });

    it('updates emailConfirmed field', async () => {
      mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
      mockQuery.mockImplementation((query: string) => {
        const trimmedQuery = query.trimStart();
        if (query === 'BEGIN' || query === 'COMMIT') {
          return Promise.resolve({ rows: [] });
        }
        if (trimmedQuery.startsWith('UPDATE users')) {
          return Promise.resolve({
            rows: [
              {
                id: 'user-1',
                email: 'user@example.com',
                email_confirmed: true,
                admin: false,
                disabled: false,
                disabled_at: null,
                disabled_by: null,
                marked_for_deletion_at: null,
                marked_for_deletion_by: null
              }
            ]
          });
        }
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ emailConfirmed: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: {
          id: 'user-1',
          email: 'user@example.com',
          emailConfirmed: true,
          admin: false,
          disabled: false,
          disabledAt: null,
          disabledBy: null,
          markedForDeletionAt: null,
          markedForDeletionBy: null,
          organizationIds: [],
          createdAt: null,
          lastActiveAt: null,
          accounting: {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            requestCount: 0,
            lastUsedAt: null
          }
        }
      });
    });

    it('returns 404 when user is missing', async () => {
      mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
      mockQuery.mockImplementation((query: string) => {
        const trimmedQuery = query.trimStart();
        if (query === 'BEGIN' || query === 'ROLLBACK') {
          return Promise.resolve({ rows: [] });
        }
        if (trimmedQuery.startsWith('UPDATE users')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ admin: true });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
    });

    it('returns 500 on database error', async () => {
      mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
      mockQuery.mockImplementation((query: string) => {
        const trimmedQuery = query.trimStart();
        if (query === 'BEGIN') {
          return Promise.resolve({ rows: [] });
        }
        if (trimmedQuery.startsWith('UPDATE users')) {
          return Promise.reject(new Error('database error'));
        }
        if (query === 'ROLLBACK') {
          return Promise.reject(new Error('rollback failed'));
        }
        return Promise.resolve({ rows: [] });
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ admin: true });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'database error' });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('PATCH /v1/admin/users/:id - validation errors', () => {
    it('returns 400 for invalid payload', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ emailConfirmed: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for non-string email', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ email: 123 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for empty email', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ email: '   ' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for non-boolean admin', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ admin: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for empty update object', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for non-boolean disabled', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ disabled: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for non-boolean markedForDeletion', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ markedForDeletion: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for invalid organizationIds', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ organizationIds: [123] });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });

    it('returns 400 for non-array organizationIds', async () => {
      const response = await request(app)
        .patch('/v1/admin/users/user-1')
        .set('Authorization', authHeader)
        .send({ organizationIds: 'org-1' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid user update payload' });
    });
  });
});
