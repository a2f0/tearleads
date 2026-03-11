import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { REVENUECAT_SIGNATURE_HEADER } from './lib/revenuecat.js';

const handleRevenueCatWebhookMock = vi.fn();

vi.mock('./lib/revenuecatWebhook.js', () => ({
  handleRevenueCatWebhook: (...args: unknown[]) =>
    handleRevenueCatWebhookMock(...args)
}));

import {
  app,
  createCorsOriginPolicy,
  isCorsOriginAllowed,
  parseCorsAllowedOrigins
} from './index.js';

describe('API', () => {
  describe('CORS policy', () => {
    it('allows localhost origins in non-production mode', async () => {
      const response = await request(app)
        .get('/healthz')
        .set('Origin', 'http://localhost:5173');

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173'
      );
    });

    it('blocks non-allowlisted origins by default', async () => {
      const response = await request(app)
        .get('/healthz')
        .set('Origin', 'https://evil.example');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('parses allowlist origins with trimming and empty-value filtering', () => {
      const allowlist = parseCorsAllowedOrigins(
        ' https://app.example.com , , https://admin.example.com '
      );

      expect(allowlist).toEqual(
        new Set(['https://app.example.com', 'https://admin.example.com'])
      );
    });

    it('applies explicit origin allowlist when loopback is disabled', () => {
      const allowlist = new Set(['https://app.example.com']);
      const corsPolicy = createCorsOriginPolicy({
        allowedOrigins: allowlist,
        allowLoopbackOrigins: false
      });
      const allowedCallback = vi.fn();
      const blockedCallback = vi.fn();
      const noOriginCallback = vi.fn();

      corsPolicy('https://app.example.com', allowedCallback);
      corsPolicy('http://localhost:3000', blockedCallback);
      corsPolicy(undefined, noOriginCallback);

      expect(allowedCallback).toHaveBeenCalledWith(null, true);
      expect(blockedCallback).toHaveBeenCalledWith(null, false);
      expect(noOriginCallback).toHaveBeenCalledWith(null, true);
    });

    it('checks loopback and allowlist origin decisions', () => {
      const allowlist = new Set(['https://app.example.com']);

      expect(
        isCorsOriginAllowed('https://app.example.com', allowlist, false)
      ).toBe(true);
      expect(
        isCorsOriginAllowed('http://localhost:3000', allowlist, true)
      ).toBe(true);
      expect(isCorsOriginAllowed('https://evil.example', allowlist, true)).toBe(
        false
      );
    });
  });

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
});
