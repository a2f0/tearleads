import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { adminContextRouter } from './context.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

describe('admin context route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns root admin context with all organizations', async () => {
    const authHeader = await createAuthHeader({
      id: 'root-1',
      email: 'root@example.com',
      admin: true
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'org-1', name: 'Alpha' },
        { id: 'org-2', name: 'Beta' }
      ]
    });

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isRootAdmin: true,
      organizations: [
        { id: 'org-1', name: 'Alpha' },
        { id: 'org-2', name: 'Beta' }
      ],
      defaultOrganizationId: null
    });
  });

  it('returns org admin context scoped to admin organizations', async () => {
    const authHeader = await createAuthHeader({
      id: 'org-admin-1',
      email: 'org-admin@example.com',
      admin: false
    });

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }, { organization_id: 'org-2' }]
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'org-2', name: 'Beta' },
          { id: 'org-1', name: 'Gamma' }
        ]
      });

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isRootAdmin: false,
      organizations: [
        { id: 'org-2', name: 'Beta' },
        { id: 'org-1', name: 'Gamma' }
      ],
      defaultOrganizationId: 'org-2'
    });
  });

  it('returns null defaultOrganizationId when org admin has no organizations loaded', async () => {
    const authHeader = await createAuthHeader({
      id: 'org-admin-empty',
      email: 'org-admin-empty@example.com',
      admin: false
    });

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isRootAdmin: false,
      organizations: [],
      defaultOrganizationId: null
    });
  });

  it('returns 500 when context loading fails for root admin', async () => {
    const authHeader = await createAuthHeader({
      id: 'root-2',
      email: 'root2@example.com',
      admin: true
    });
    mockQuery.mockRejectedValueOnce(new Error('load failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'load failed' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns fallback error message when context loading throws a non-Error', async () => {
    const authHeader = await createAuthHeader({
      id: 'root-3',
      email: 'root3@example.com',
      admin: true
    });
    mockQuery.mockRejectedValueOnce('load failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to load admin context' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns 403 when user has no root or org-admin access', async () => {
    const authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user@example.com',
      admin: false
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', authHeader);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 500 when admin access middleware lookup fails', async () => {
    const authHeader = await createAuthHeader({
      id: 'org-admin-2',
      email: 'org-admin2@example.com',
      admin: false
    });
    mockGetPostgresPool.mockRejectedValueOnce(new Error('db offline'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to authorize admin access'
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns 401 when context route is mounted without admin access middleware', async () => {
    const isolatedApp = express();
    isolatedApp.use('/', adminContextRouter);

    const response = await request(isolatedApp).get('/');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });
});
