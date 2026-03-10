import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectRouteRateLimitMiddleware } from './connectRouteRateLimit.js';
import { setTestEnv } from '../test/env.js';

function createTestApp() {
  const app = express();
  app.use(createConnectRouteRateLimitMiddleware());
  app.get('/limited', (_request, response) => {
    response.status(200).json({ ok: true });
  });
  return app;
}

describe('connectRouteRateLimitMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T00:00:00.000Z'));
    setTestEnv('NODE_ENV', 'production');
    setTestEnv('VITEST', 'false');
    setTestEnv('CONNECT_ROUTE_RATE_LIMIT_WINDOW_MS', '1000');
    setTestEnv('CONNECT_ROUTE_RATE_LIMIT_MAX_REQUESTS', '2');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the configured window', async () => {
    const app = createTestApp();

    const first = await request(app).get('/limited');
    const second = await request(app).get('/limited');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('returns 429 when request count exceeds limit', async () => {
    const app = createTestApp();

    await request(app).get('/limited');
    await request(app).get('/limited');
    const third = await request(app).get('/limited');

    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: 'Too many requests' });
  });

  it('resets counters after the window elapses', async () => {
    const app = createTestApp();

    await request(app).get('/limited');
    await request(app).get('/limited');
    const blocked = await request(app).get('/limited');
    expect(blocked.status).toBe(429);

    vi.advanceTimersByTime(1000);
    const allowed = await request(app).get('/limited');
    expect(allowed.status).toBe(200);
  });

  it('bypasses rate limiting in test runtime', async () => {
    setTestEnv('NODE_ENV', 'test');
    const app = createTestApp();

    await request(app).get('/limited');
    await request(app).get('/limited');
    const third = await request(app).get('/limited');

    expect(third.status).toBe(200);
  });
});
