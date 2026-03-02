import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from './index.js';

describe('API', () => {
  describe('GET /v1/ping', () => {
    it('should return version with 200 status', async () => {
      const response = await request(app).get('/v1/ping');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        version: expect.any(String),
        dbVersion: expect.any(String)
      });
      expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(response.body.dbVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('includes emailDomain when SMTP_RECIPIENT_DOMAINS is configured', async () => {
      const original = process.env['SMTP_RECIPIENT_DOMAINS'];
      process.env['SMTP_RECIPIENT_DOMAINS'] =
        'alpha.example.com,beta.example.com';

      try {
        const response = await request(app).get('/v1/ping');
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          emailDomain: 'alpha.example.com'
        });
      } finally {
        if (original === undefined) {
          delete process.env['SMTP_RECIPIENT_DOMAINS'];
        } else {
          process.env['SMTP_RECIPIENT_DOMAINS'] = original;
        }
      }
    });
  });

  describe('404 handler', () => {
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
