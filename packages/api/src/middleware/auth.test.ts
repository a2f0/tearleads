import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';

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
});
