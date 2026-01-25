import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('admin users routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user@example.com',
      admin: true
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('GET /v1/admin/users returns users', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'user-1',
            email: 'alpha@example.com',
            email_confirmed: true,
            admin: false,
            organization_ids: []
          },
          {
            id: 'user-2',
            email: 'beta@example.com',
            email_confirmed: false,
            admin: true,
            organization_ids: ['org-1']
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
          organizationIds: []
        },
        {
          id: 'user-2',
          email: 'beta@example.com',
          emailConfirmed: false,
          admin: true,
          organizationIds: ['org-1']
        }
      ]
    });
  });

  it('GET /v1/admin/users returns 500 on error', async () => {
    mockGetPostgresPool.mockRejectedValue(new Error('query failed'));
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

  it('GET /v1/admin/users/:id returns a single user', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'user-1',
            email: 'alpha@example.com',
            email_confirmed: true,
            admin: false,
            organization_ids: ['org-1', 'org-2']
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
        organizationIds: ['org-1', 'org-2']
      }
    });
  });

  it('GET /v1/admin/users/:id returns 404 when user not found', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: []
      })
    });

    const response = await request(app)
      .get('/v1/admin/users/nonexistent')
      .set('Authorization', authHeader);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'User not found' });
  });

  it('GET /v1/admin/users/:id returns 500 on error', async () => {
    mockGetPostgresPool.mockRejectedValue(new Error('query failed'));
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

  it('PATCH /v1/admin/users/:id updates a user', async () => {
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
              admin: true
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
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
        organizationIds: []
      }
    });
    expect(mockQuery).toHaveBeenCalled();
  });

  it('PATCH /v1/admin/users/:id returns 400 for invalid payload', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ emailConfirmed: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for non-string email', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ email: 123 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for empty email', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ email: '   ' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for non-boolean admin', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ admin: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for empty update object', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 404 when user is missing', async () => {
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

  it('returns 403 when session is not admin', async () => {
    const nonAdminHeader = await createAuthHeader({
      id: 'user-2',
      email: 'user@example.com',
      admin: false
    });

    const response = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', nonAdminHeader);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('PATCH /v1/admin/users/:id updates emailConfirmed field', async () => {
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
              admin: false
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
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
        organizationIds: []
      }
    });
  });

  it('PATCH /v1/admin/users/:id updates organization IDs', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (query.startsWith('SELECT id, email, email_confirmed, admin')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-1',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false
            }
          ]
        });
      }
      if (query.startsWith('SELECT id FROM organizations')) {
        return Promise.resolve({ rows: [{ id: 'org-1' }, { id: 'org-2' }] });
      }
      if (query.startsWith('DELETE FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.startsWith('INSERT INTO user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({
          rows: [{ organization_id: 'org-1' }, { organization_id: 'org-2' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ organizationIds: ['org-1', 'org-2'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        emailConfirmed: true,
        admin: false,
        organizationIds: ['org-1', 'org-2']
      }
    });
  });

  it('PATCH /v1/admin/users/:id returns 400 for invalid organizationIds', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ organizationIds: [123] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 500 on database error', async () => {
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
        return Promise.resolve({ rows: [] });
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
