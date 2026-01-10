import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './index.js';

describe('API', () => {
  describe('GET /v1/ping', () => {
    it('should return version with 200 status', async () => {
      const response = await request(app).get('/v1/ping');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        version: expect.any(String),
        dbVersion: expect.any(String)
      });
      expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(response.body.dbVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found' });
    });
  });
});
