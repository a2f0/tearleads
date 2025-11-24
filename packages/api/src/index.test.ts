import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './index.js';

describe('API', () => {
  describe('GET /api/health', () => {
    it('should return health data with 200 status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        timestamp: expect.any(String),
        uptime: expect.any(Number),
      });
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
