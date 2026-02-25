import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { getRootHandler as getUsersRootHandler } from './users/getRoot.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockGetLatestLastActiveByUserIds = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

vi.mock('../../lib/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sessions.js')>();
  return {
    ...actual,
    getLatestLastActiveByUserIds: (userIds: string[]) =>
      mockGetLatestLastActiveByUserIds(userIds),
    deleteAllSessionsForUser: vi.fn()
  };
});

describe('admin users routes - GET', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockGetLatestLastActiveByUserIds.mockResolvedValue({});
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

  describe('GET /v1/admin/users', () => {
    it('returns users', async () => {
      mockGetLatestLastActiveByUserIds.mockResolvedValue({
        'user-1': '2024-01-05T00:00:00.000Z',
        'user-2': null
      });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'user-1',
                email: 'alpha@example.com',
                email_confirmed: true,
                admin: false,
                disabled: false,
                disabled_at: null,
                disabled_by: null,
                marked_for_deletion_at: null,
                marked_for_deletion_by: null,
                organization_ids: [],
                created_at: new Date('2024-01-01T00:00:00.000Z')
              },
              {
                id: 'user-2',
                email: 'beta@example.com',
                email_confirmed: false,
                admin: true,
                disabled: false,
                disabled_at: null,
                disabled_by: null,
                marked_for_deletion_at: null,
                marked_for_deletion_by: null,
                organization_ids: ['org-1'],
                created_at: new Date('2024-02-01T00:00:00.000Z')
              }
            ]
          })
          .mockResolvedValueOnce({
            rows: [
              {
                user_id: 'user-1',
                total_prompt_tokens: '120',
                total_completion_tokens: '80',
                total_tokens: '200',
                request_count: '3',
                last_used_at: new Date('2024-01-04T00:00:00.000Z')
              }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        users: [
          {
            id: 'user-1',
            email: 'alpha@example.com',
            emailConfirmed: true,
            admin: false,
            disabled: false,
            disabledAt: null,
            disabledBy: null,
            markedForDeletionAt: null,
            markedForDeletionBy: null,
            organizationIds: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastActiveAt: '2024-01-05T00:00:00.000Z',
            accounting: {
              totalPromptTokens: 120,
              totalCompletionTokens: 80,
              totalTokens: 200,
              requestCount: 3,
              lastUsedAt: '2024-01-04T00:00:00.000Z'
            }
          },
          {
            id: 'user-2',
            email: 'beta@example.com',
            emailConfirmed: false,
            admin: true,
            disabled: false,
            disabledAt: null,
            disabledBy: null,
            markedForDeletionAt: null,
            markedForDeletionBy: null,
            organizationIds: ['org-1'],
            createdAt: '2024-02-01T00:00:00.000Z',
            lastActiveAt: null,
            accounting: {
              totalPromptTokens: 0,
              totalCompletionTokens: 0,
              totalTokens: 0,
              requestCount: 0,
              lastUsedAt: null
            }
          }
        ]
      });
    });

    it('returns empty users list', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ users: [] });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockRejectedValueOnce(new Error('query failed'))
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'query failed' });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('returns scoped users for org admin', async () => {
      const orgAdminHeader = await createAuthHeader({
        id: 'org-admin-1',
        email: 'org-admin@example.com',
        admin: false
      });
      mockGetLatestLastActiveByUserIds.mockResolvedValue({});
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [{ organization_id: 'org-2' }]
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'user-2',
                email: 'beta@example.com',
                email_confirmed: false,
                admin: false,
                disabled: false,
                disabled_at: null,
                disabled_by: null,
                marked_for_deletion_at: null,
                marked_for_deletion_by: null,
                organization_ids: ['org-2'],
                created_at: new Date('2024-02-01T00:00:00.000Z')
              }
            ]
          })
          .mockResolvedValueOnce({
            rows: []
          })
      });

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', orgAdminHeader);

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('WHERE EXISTS'),
        [['org-2']]
      );
    });

    it('supports root admin filtering by organizationId', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValueOnce({
          rows: []
        })
      });

      const response = await request(app)
        .get('/v1/admin/users?organizationId=org-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ users: [] });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE EXISTS'),
        [['org-1']]
      );
    });

    it('returns fallback error on non-Error failures', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockRejectedValueOnce('query failed')
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to query users' });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('returns 401 when users handler is mounted without admin access middleware', async () => {
      const isolatedApp = express();
      isolatedApp.get('/', getUsersRootHandler);

      const response = await request(isolatedApp).get('/');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 when session is not admin', async () => {
      const nonAdminHeader = await createAuthHeader({
        id: 'user-2',
        email: 'user@example.com',
        admin: false
      });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', nonAdminHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('returns 403 when org admin requests unauthorized organization', async () => {
      const orgAdminHeader = await createAuthHeader({
        id: 'org-admin-1',
        email: 'org-admin@example.com',
        admin: false
      });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValueOnce({
          rows: [{ organization_id: 'org-1' }]
        })
      });

      const response = await request(app)
        .get('/v1/admin/users?organizationId=org-2')
        .set('Authorization', orgAdminHeader);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('returns 400 for non-string organizationId query', async () => {
      const response = await request(app)
        .get('/v1/admin/users?organizationId=org-1&organizationId=org-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'organizationId query must be a string'
      });
    });

    it('returns 400 for empty organizationId query', async () => {
      const response = await request(app)
        .get('/v1/admin/users?organizationId=%20%20')
        .set('Authorization', authHeader);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'organizationId query cannot be empty'
      });
    });
  });

  describe('GET /v1/admin/users/:id', () => {
    it('returns a single user', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'user-1',
                email: 'alpha@example.com',
                email_confirmed: true,
                admin: false,
                disabled: false,
                disabled_at: null,
                disabled_by: null,
                marked_for_deletion_at: null,
                marked_for_deletion_by: null,
                organization_ids: ['org-1', 'org-2']
              }
            ]
          })
          .mockResolvedValueOnce({
            rows: [
              {
                user_id: 'user-1',
                total_prompt_tokens: '30',
                total_completion_tokens: '70',
                total_tokens: '100',
                request_count: '1',
                last_used_at: new Date('2024-02-02T00:00:00.000Z')
              }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/users/user-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: {
          id: 'user-1',
          email: 'alpha@example.com',
          emailConfirmed: true,
          admin: false,
          disabled: false,
          disabledAt: null,
          disabledBy: null,
          markedForDeletionAt: null,
          markedForDeletionBy: null,
          organizationIds: ['org-1', 'org-2'],
          createdAt: null,
          lastActiveAt: null,
          accounting: {
            totalPromptTokens: 30,
            totalCompletionTokens: 70,
            totalTokens: 100,
            requestCount: 1,
            lastUsedAt: '2024-02-02T00:00:00.000Z'
          }
        }
      });
    });

    it('returns 404 when user not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/users/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockRejectedValueOnce(new Error('query failed'))
      });
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/users/user-1')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'query failed' });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
