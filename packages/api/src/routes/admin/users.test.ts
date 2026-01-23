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
            admin: false
          },
          {
            id: 'user-2',
            email: 'beta@example.com',
            email_confirmed: false,
            admin: true
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
          admin: false
        },
        {
          id: 'user-2',
          email: 'beta@example.com',
          emailConfirmed: false,
          admin: true
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

  it('PATCH /v1/admin/users/:id updates a user', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'user-1',
            email: 'updated@example.com',
            email_confirmed: true,
            admin: true
          }
        ]
      })
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
        admin: true
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

  it('PATCH /v1/admin/users/:id returns 404 when user is missing', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: []
      })
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
});
