import { create } from '@bufbuild/protobuf';
import {
  Code,
  createContextValues,
  createHandlerContext
} from '@connectrpc/connect';
import {
  BillingService,
  GetOrganizationBillingRequestSchema
} from '@tearleads/shared/gen/tearleads/v1/billing_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_AUTH_CONTEXT_KEY } from '../context.js';
import { billingConnectService } from './billingService.js';

const mockQuery = vi.fn();
const mockGetPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => mockGetPool(...args)
}));

function createAuthContext() {
  const contextValues = createContextValues();
  contextValues.set(CONNECT_AUTH_CONTEXT_KEY, {
    claims: {
      sub: 'user-1',
      email: 'user-1@example.com',
      jti: 'session-1'
    },
    session: {
      userId: 'user-1',
      email: 'user-1@example.com',
      admin: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      lastActiveAt: '2026-03-02T00:00:00.000Z',
      ipAddress: '127.0.0.1'
    }
  });

  return createHandlerContext({
    service: BillingService,
    method: BillingService.method.getOrganizationBilling,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: 'http://localhost/v1/connect/tearleads.v1.BillingService/GetOrganizationBilling',
    contextValues
  });
}

function createUnauthenticatedContext() {
  return createHandlerContext({
    service: BillingService,
    method: BillingService.method.getOrganizationBilling,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: 'http://localhost/v1/connect/tearleads.v1.BillingService/GetOrganizationBilling'
  });
}

describe('billingConnectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPool.mockResolvedValue({ query: mockQuery });
  });

  it('returns unauthenticated when auth context is missing', async () => {
    await expect(
      billingConnectService.getOrganizationBilling(
        create(GetOrganizationBillingRequestSchema, {
          organizationId: 'org-1'
        }),
        createUnauthenticatedContext()
      )
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns invalid argument for blank organization id', async () => {
    await expect(
      billingConnectService.getOrganizationBilling(
        create(GetOrganizationBillingRequestSchema, { organizationId: '   ' }),
        createAuthContext()
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns permission denied when membership is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      billingConnectService.getOrganizationBilling(
        create(GetOrganizationBillingRequestSchema, {
          organizationId: 'org-1'
        }),
        createAuthContext()
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('returns not found when billing account is missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      billingConnectService.getOrganizationBilling(
        create(GetOrganizationBillingRequestSchema, {
          organizationId: 'org-1'
        }),
        createAuthContext()
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns billing account for authorized member', async () => {
    const now = new Date('2026-03-02T12:00:00.000Z');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
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
      });

    const response = await billingConnectService.getOrganizationBilling(
      create(GetOrganizationBillingRequestSchema, { organizationId: 'org-1' }),
      createAuthContext()
    );

    expect(response.billingAccount).toEqual({
      organizationId: 'org-1',
      revenuecatAppUserId: 'org:org-1',
      entitlementStatus: 'active',
      activeProductId: 'pro_monthly',
      periodEndsAt: now.toISOString(),
      willRenew: true,
      lastWebhookEventId: 'evt_1',
      lastWebhookAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  });

  it('omits nullable billing fields when they are null', async () => {
    const now = new Date('2026-03-02T12:00:00.000Z');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            organization_id: 'org-1',
            revenuecat_app_user_id: 'org:org-1',
            entitlement_status: 'inactive',
            active_product_id: null,
            period_ends_at: null,
            will_renew: null,
            last_webhook_event_id: null,
            last_webhook_at: null,
            created_at: now,
            updated_at: now
          }
        ]
      });

    const response = await billingConnectService.getOrganizationBilling(
      create(GetOrganizationBillingRequestSchema, { organizationId: 'org-1' }),
      createAuthContext()
    );

    expect(response.billingAccount).toEqual({
      organizationId: 'org-1',
      revenuecatAppUserId: 'org:org-1',
      entitlementStatus: 'inactive',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  });

  it('returns internal when query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    try {
      await expect(
        billingConnectService.getOrganizationBilling(
          create(GetOrganizationBillingRequestSchema, {
            organizationId: 'org-1'
          }),
          createAuthContext()
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
