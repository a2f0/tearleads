import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createJwt } from '../lib/jwt.js';
import { createSession, deleteSession } from '../lib/sessions.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/console-mocks.js';

const fetchMock = vi.fn<typeof fetch>();

describe('Auth middleware', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubGlobal('fetch', fetchMock);
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('allows ping without auth', async () => {
    const response = await request(app).get('/v1/ping');

    expect(response.status).toBe(200);
  });

  it('allows login without auth', async () => {
    const response = await request(app).post('/v1/auth/login').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'email and password are required' });
  });

  it('rejects missing auth on protected routes', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .send({
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('accepts valid auth sessions', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', authHeader)
      .send({
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects invalid JWT token', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer invalid-token')
      .send({
        messages: [{ role: 'user', content: 'Hello' }]
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects when session is not found', async () => {
    const token = createJwt(
      { sub: 'user-1', email: 'user@example.com', jti: 'nonexistent-session' },
      'test-secret',
      3600
    );

    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messages: [{ role: 'user', content: 'Hello' }]
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects when session userId does not match JWT sub', async () => {
    const sessionId = 'mismatched-session-id';
    await createSession(sessionId, {
      userId: 'different-user',
      email: 'different@example.com',
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      { sub: 'user-1', email: 'user@example.com', jti: sessionId },
      'test-secret',
      3600
    );

    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messages: [{ role: 'user', content: 'Hello' }]
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });

    await deleteSession(sessionId, 'different-user');
  });

  it('handles getSession errors gracefully', async () => {
    const consoleSpy = mockConsoleError();
    vi.spyOn(
      await import('../lib/sessions.js'),
      'getSession'
    ).mockRejectedValueOnce(new Error('Redis connection failed'));

    const sessionId = 'error-test-session';
    await createSession(sessionId, {
      userId: 'user-1',
      email: 'user@example.com',
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      { sub: 'user-1', email: 'user@example.com', jti: sessionId },
      'test-secret',
      3600
    );

    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messages: [{ role: 'user', content: 'Hello' }]
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to authenticate' });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Auth middleware failed:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
    await deleteSession(sessionId, 'user-1');
  });
});
