import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  adminAccessMiddleware,
  canAccessOrganization,
  requireRootAdmin
} from './admin-access.js';

describe('admin access middleware helpers', () => {
  it('returns 401 when claims exist but session is missing', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.authClaims = { sub: 'user-1', jti: 'session-1' };
      next();
    });
    app.use(adminAccessMiddleware);
    app.get('/secure', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(app).get('/secure');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when requireRootAdmin is called without root access', async () => {
    const app = express();
    app.get('/root-check', (req, res) => {
      if (requireRootAdmin(req, res)) {
        res.json({ allowed: true });
      }
    });

    const response = await request(app).get('/root-check');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('returns false when canAccessOrganization is called without access context', async () => {
    const app = express();
    app.get('/org-check', (req, res) => {
      const allowed = canAccessOrganization(req, 'org-1');
      res.json({ allowed });
    });

    const response = await request(app).get('/org-check');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allowed: false });
  });
});
