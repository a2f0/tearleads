import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from './index.js';

describe('API', () => {
  describe('GET /healthz', () => {
    it('returns ok status', async () => {
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('404 handler', () => {
    it('should return 404 for removed v1 ping route', async () => {
      const response = await request(app).get('/v1/ping');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found' });
    });

    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found' });
    });
  });

  it('loads with explicit PORT env and exports app in test mode', async () => {
    const originalPort = process.env['PORT'];
    const originalNodeEnv = process.env['NODE_ENV'];
    process.env['PORT'] = '4321';
    process.env['NODE_ENV'] = 'test';

    try {
      vi.resetModules();
      const mod = await import('./index.js');
      expect(mod.app).toBeDefined();
    } finally {
      if (originalPort === undefined) {
        delete process.env['PORT'];
      } else {
        process.env['PORT'] = originalPort;
      }
      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
      vi.resetModules();
    }
  });
});
