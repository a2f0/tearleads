import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

describe('orgMembership middleware', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user@example.com',
      admin: false
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('proceeds without header and no DB query', async () => {
    // Downstream route handler also calls getPostgresPool, so mock
    // console.error to suppress its expected failure and verify the
    // middleware itself did not block the request.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'org-1',
            name: 'Personal',
            is_personal: true,
            organization_id: 'org-1'
          }
        ]
      })
    });

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', authHeader);

    // Middleware should not block (no 400 or 403 from org validation)
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(400);
    consoleError.mockRestore();
  });

  it('proceeds with valid header and valid membership', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const orgId = '550e8400-e29b-41d4-a716-446655440000';

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [
          {
            id: orgId,
            organization_id: orgId,
            name: 'Team',
            is_personal: false
          }
        ]
      })
    });

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgId);

    // Middleware should not block (membership check passed)
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(400);
    consoleError.mockRestore();
  });

  it('returns 403 when user is not a member of the org', async () => {
    const orgId = '550e8400-e29b-41d4-a716-446655440000';
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgId);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Not a member of the specified organization'
    });
  });

  it('proceeds with personal org ID format', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const personalOrgId =
      'personal-org-550e8400-e29b-41d4-a716-446655440000';

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [{ organization_id: personalOrgId }]
      })
    });

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', personalOrgId);

    expect(response.status).not.toBe(400);
    consoleError.mockRestore();
  });

  it('returns 400 for invalid org ID format', async () => {
    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'org id with spaces!@#');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid X-Organization-Id format'
    });
  });

  it('returns 400 for overly long org ID', async () => {
    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'a'.repeat(101));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid X-Organization-Id format'
    });
  });

  it('skips validation for auth exempt paths', async () => {
    const response = await request(app)
      .get('/v1/ping')
      .set('X-Organization-Id', 'any-value');

    expect(response.status).toBe(200);
  });

  it('skips validation for admin paths', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const adminAuthHeader = await createAuthHeader({
      id: 'admin-1',
      email: 'admin@example.com',
      admin: true
    });

    const response = await request(app)
      .get('/v1/admin/context')
      .set('Authorization', adminAuthHeader)
      .set('X-Organization-Id', 'any-value');

    expect(response.status).not.toBe(400);
    consoleError.mockRestore();
  });

  it('returns 500 when DB query fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const orgId = '550e8400-e29b-41d4-a716-446655440000';
    mockGetPostgresPool.mockRejectedValue(new Error('connection error'));

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgId);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to verify organization membership'
    });
    consoleError.mockRestore();
  });
});
