import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminAccessMiddleware,
  canAccessOrganization,
  ensureOrganizationAccess,
  parseOrganizationIdQuery,
  requireRootAdmin
} from './adminAccess.js';

const getPostgresPoolMock = vi.fn();
const queryMock = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

function attachAuthenticatedSession(admin: boolean) {
  return (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.authClaims = { sub: 'user-1', jti: 'session-1' };
    req.session = {
      userId: 'user-1',
      email: 'user-1@example.com',
      admin,
      createdAt: '2026-03-03T00:00:00.000Z',
      lastActiveAt: '2026-03-03T00:00:00.000Z',
      ipAddress: '127.0.0.1'
    };
    next();
  };
}

describe('adminAccess middleware coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
  });

  it('allows root admins without querying organization memberships', async () => {
    const app = express();
    app.use(attachAuthenticatedSession(true));
    app.use(adminAccessMiddleware);
    app.get('/secure', (req, res) => {
      res.json(req.adminAccess);
    });

    const response = await request(app).get('/secure');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ isRootAdmin: true, organizationIds: [] });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('loads org-admin memberships for non-root admins', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-1' }, { organization_id: 'org-2' }]
    });

    const app = express();
    app.use(attachAuthenticatedSession(false));
    app.use(adminAccessMiddleware);
    app.get('/secure', (req, res) => {
      res.json(req.adminAccess);
    });

    const response = await request(app).get('/secure');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isRootAdmin: false,
      organizationIds: ['org-1', 'org-2']
    });
  });

  it('returns forbidden when a non-root admin has no org admin memberships', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const app = express();
    app.use(attachAuthenticatedSession(false));
    app.use(adminAccessMiddleware);
    app.get('/secure', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(app).get('/secure');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('returns internal server error when membership lookup fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockRejectedValueOnce(new Error('db down'));

    const app = express();
    app.use(attachAuthenticatedSession(false));
    app.use(adminAccessMiddleware);
    app.get('/secure', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(app).get('/secure');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to authorize admin access'
    });
    consoleSpy.mockRestore();
  });

  it('supports root/non-root organization access helpers', async () => {
    const app = express();

    app.get('/root-required', (req, res) => {
      req.adminAccess = { isRootAdmin: true, organizationIds: [] };
      if (requireRootAdmin(req, res)) {
        res.json({ allowed: true });
      }
    });

    app.get('/org-access-root', (req, res) => {
      req.adminAccess = { isRootAdmin: true, organizationIds: [] };
      res.json({ allowed: canAccessOrganization(req, 'org-9') });
    });

    app.get('/org-access-denied', (req, res) => {
      req.adminAccess = { isRootAdmin: false, organizationIds: ['org-1'] };
      if (ensureOrganizationAccess(req, res, 'org-9')) {
        res.json({ allowed: true });
      }
    });

    const rootRequired = await request(app).get('/root-required');
    expect(rootRequired.status).toBe(200);
    expect(rootRequired.body).toEqual({ allowed: true });

    const rootOrgAccess = await request(app).get('/org-access-root');
    expect(rootOrgAccess.status).toBe(200);
    expect(rootOrgAccess.body).toEqual({ allowed: true });

    const deniedOrgAccess = await request(app).get('/org-access-denied');
    expect(deniedOrgAccess.status).toBe(403);
    expect(deniedOrgAccess.body).toEqual({ error: 'Forbidden' });
  });

  it('parses organization id query values', async () => {
    const app = express();

    app.get('/parse', (req, res) => {
      const organizationId = parseOrganizationIdQuery(req, res);
      if (organizationId === undefined) {
        return;
      }
      res.json({ organizationId });
    });

    const missing = await request(app).get('/parse');
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual({ organizationId: null });

    const valid = await request(app).get('/parse?organizationId=%20org-1%20');
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ organizationId: 'org-1' });

    const empty = await request(app).get('/parse?organizationId=');
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({
      error: 'organizationId query cannot be empty'
    });

    const multi = await request(app).get(
      '/parse?organizationId=org-1&organizationId=org-2'
    );
    expect(multi.status).toBe(400);
    expect(multi.body).toEqual({
      error: 'organizationId query must be a string'
    });
  });
});
