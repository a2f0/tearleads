import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
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
});
