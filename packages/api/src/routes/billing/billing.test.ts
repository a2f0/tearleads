import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

describe('billing routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user@example.com',
      admin: false
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when unauthenticated', async () => {
    const response = await request(app).get('/v1/billing/organizations/org-1');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns billing status for organizations the user belongs to', async () => {
    const now = new Date();
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({
          rows: [{ organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              organization_id: 'org-1',
              revenuecat_app_user_id: 'org:org-1',
              entitlement_status: 'active',
              active_product_id: 'pro_monthly',
              period_ends_at: now,
              will_renew: true,
              last_webhook_event_id: 'evt_1',
              last_webhook_at: now,
              created_at: now,
              updated_at: now
            }
          ]
        })
    });

    const response = await request(app)
      .get('/v1/billing/organizations/org-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      billingAccount: {
        organizationId: 'org-1',
        revenueCatAppUserId: 'org:org-1',
        entitlementStatus: 'active',
        activeProductId: 'pro_monthly',
        periodEndsAt: now.toISOString(),
        willRenew: true,
        lastWebhookEventId: 'evt_1',
        lastWebhookAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    });
  });

  it('returns 403 when the user is not a member of the organization', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .get('/v1/billing/organizations/org-2')
      .set('Authorization', authHeader);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when billing account is missing', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({
          rows: [{ organization_id: 'org-1' }]
        })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .get('/v1/billing/organizations/org-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Billing account not found' });
  });

  it('returns 500 when the query fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockGetPostgresPool.mockRejectedValue(new Error('database error'));

    const response = await request(app)
      .get('/v1/billing/organizations/org-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to fetch billing account' });
    consoleError.mockRestore();
  });
});
