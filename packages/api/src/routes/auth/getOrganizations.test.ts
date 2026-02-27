import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createJwt } from '../../lib/jwt.js';
import { createSession, deleteSession } from '../../lib/sessions.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

describe('GET /auth/organizations', () => {
  const userId = 'org-test-user-1';
  const sessionId = 'org-test-session-1';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 without auth token', async () => {
    const response = await request(app).get('/v1/auth/organizations');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it(
    'returns organizations for authenticated user',
    { timeout: 15000 },
    async () => {
      await createSession(sessionId, {
        userId,
        email: 'org-test@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const token = createJwt(
        { sub: userId, email: 'org-test@example.com', jti: sessionId },
        'test-secret',
        3600
      );

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'personal-org-1',
              name: 'Personal',
              is_personal: true
            },
            {
              id: 'team-org-1',
              name: 'Team Alpha',
              is_personal: false
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [{ personal_organization_id: 'personal-org-1' }]
        });

      const response = await request(app)
        .get('/v1/auth/organizations')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.organizations).toHaveLength(2);
      expect(response.body.organizations[0]).toEqual({
        id: 'personal-org-1',
        name: 'Personal',
        isPersonal: true
      });
      expect(response.body.organizations[1]).toEqual({
        id: 'team-org-1',
        name: 'Team Alpha',
        isPersonal: false
      });
      expect(response.body.personalOrganizationId).toBe('personal-org-1');

      await deleteSession(sessionId, userId);
    }
  );

  it('returns empty list when user has no organizations', async () => {
    await createSession(sessionId, {
      userId,
      email: 'org-test@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      { sub: userId, email: 'org-test@example.com', jti: sessionId },
      'test-secret',
      3600
    );

    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ personal_organization_id: 'personal-org-1' }]
    });

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.organizations).toEqual([]);
    expect(response.body.personalOrganizationId).toBe('personal-org-1');

    await deleteSession(sessionId, userId);
  });

  it('returns 500 when user record is not found', async () => {
    mockConsoleError();

    await createSession(sessionId, {
      userId,
      email: 'org-test@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      { sub: userId, email: 'org-test@example.com', jti: sessionId },
      'test-secret',
      3600
    );

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'User record not found' });

    await deleteSession(sessionId, userId);
  });

  it('returns 500 when database query fails', async () => {
    mockConsoleError();

    await createSession(sessionId, {
      userId,
      email: 'org-test@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      { sub: userId, email: 'org-test@example.com', jti: sessionId },
      'test-secret',
      3600
    );

    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const response = await request(app)
      .get('/v1/auth/organizations')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to list organizations' });

    await deleteSession(sessionId, userId);
  });
});
