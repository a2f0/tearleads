import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { hashPassword } from '../lib/passwords.js';
import { mockConsoleError } from '../test/console-mocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('Auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 400 when payload is missing', async () => {
    const response = await request(app).post('/v1/auth/login').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'email and password are required' });
  });

  it('returns 401 when user is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 401 when password does not match', async () => {
    const credentials = await hashPassword('other-password');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'user@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt
        }
      ]
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 200 with access token on success', async () => {
    const password = 'correct-password';
    const credentials = await hashPassword(password);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'user@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt
        }
      ]
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.tokenType).toBe('Bearer');
    expect(response.body.expiresIn).toBe(3600);
    expect(response.body.user).toEqual({
      id: 'user-1',
      email: 'user@example.com'
    });
  });

  it('returns 500 when login query fails', async () => {
    mockConsoleError();
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to authenticate' });
  });

  it('returns 500 when JWT_SECRET is not configured', async () => {
    mockConsoleError();
    vi.unstubAllEnvs();

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to authenticate' });
  });
});
