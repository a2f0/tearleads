import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { REVENUECAT_SIGNATURE_HEADER } from './lib/revenuecat.js';

const { handleRevenueCatWebhookMock } = vi.hoisted(() => ({
  handleRevenueCatWebhookMock: vi.fn()
}));

vi.mock('./lib/revenuecatWebhook.js', () => ({
  handleRevenueCatWebhook: handleRevenueCatWebhookMock
}));

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

  describe('POST /v1/revenuecat/webhooks', () => {
    it('uses raw body webhook handler', async () => {
      handleRevenueCatWebhookMock.mockResolvedValueOnce({
        status: 200,
        payload: { ok: true }
      });

      const webhookBody = '{"event":"test"}';
      const response = await request(app)
        .post('/v1/revenuecat/webhooks')
        .set('Content-Type', 'application/json')
        .set(REVENUECAT_SIGNATURE_HEADER, 'rc-signature')
        .send(webhookBody);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(handleRevenueCatWebhookMock).toHaveBeenCalledTimes(1);

      const firstCall = handleRevenueCatWebhookMock.mock.calls[0];
      expect(firstCall).toBeDefined();
      const payloadArg = firstCall?.[0];
      expect(payloadArg).toBeDefined();
      expect(payloadArg?.signature).toBe('rc-signature');
      expect(Buffer.isBuffer(payloadArg?.rawBody)).toBe(true);
      expect(payloadArg?.rawBody.toString()).toBe(webhookBody);
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
