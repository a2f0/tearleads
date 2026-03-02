import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import type { GetOrganizationBillingRequest } from '@tearleads/shared/gen/tearleads/v1/billing_pb';
import { getPool } from '../../lib/postgres.js';
import { getRequiredConnectAuthContext } from '../context.js';

// COMPLIANCE_SENTINEL: TL-PAY-005 | control=billing-data-authorization

type MembershipRow = {
  organization_id: string;
};

type BillingAccountRow = {
  organization_id: string;
  revenuecat_app_user_id: string;
  entitlement_status: string;
  active_product_id: string | null;
  period_ends_at: Date | null;
  will_renew: boolean | null;
  last_webhook_event_id: string | null;
  last_webhook_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function getAuthUserId(context: HandlerContext): string {
  const authContext = getRequiredConnectAuthContext(context);
  if (!authContext) {
    throw new ConnectError('Unauthorized', Code.Unauthenticated);
  }
  return authContext.claims.sub;
}

function normalizeOrganizationId(organizationId: string): string {
  const normalized = organizationId.trim();
  if (normalized.length === 0) {
    throw new ConnectError('organizationId is required', Code.InvalidArgument);
  }
  return normalized;
}

export const billingConnectService = {
  getOrganizationBilling: async (
    request: GetOrganizationBillingRequest,
    context: HandlerContext
  ) => {
    const userId = getAuthUserId(context);
    const organizationId = normalizeOrganizationId(request.organizationId);

    try {
      const pool = await getPool('read');
      const membershipResult = await pool.query<MembershipRow>(
        `SELECT organization_id
         FROM user_organizations
         WHERE user_id = $1
           AND organization_id = $2
         LIMIT 1`,
        [userId, organizationId]
      );

      if (!membershipResult.rows[0]) {
        throw new ConnectError('Forbidden', Code.PermissionDenied);
      }

      const billingResult = await pool.query<BillingAccountRow>(
        `SELECT
           organization_id,
           revenuecat_app_user_id,
           entitlement_status,
           active_product_id,
           period_ends_at,
           will_renew,
           last_webhook_event_id,
           last_webhook_at,
           created_at,
           updated_at
         FROM organization_billing_accounts
         WHERE organization_id = $1
         LIMIT 1`,
        [organizationId]
      );

      const row = billingResult.rows[0];
      if (!row) {
        throw new ConnectError('Billing account not found', Code.NotFound);
      }

      const billingAccount = {
        organizationId: row.organization_id,
        revenuecatAppUserId: row.revenuecat_app_user_id,
        entitlementStatus: row.entitlement_status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        ...(row.active_product_id
          ? { activeProductId: row.active_product_id }
          : {}),
        ...(row.period_ends_at
          ? { periodEndsAt: row.period_ends_at.toISOString() }
          : {}),
        ...(row.will_renew !== null ? { willRenew: row.will_renew } : {}),
        ...(row.last_webhook_event_id
          ? { lastWebhookEventId: row.last_webhook_event_id }
          : {}),
        ...(row.last_webhook_at
          ? { lastWebhookAt: row.last_webhook_at.toISOString() }
          : {})
      };

      return {
        billingAccount
      };
    } catch (error) {
      if (error instanceof ConnectError) {
        throw error;
      }
      console.error('Failed to fetch billing account:', error);
      throw new ConnectError('Failed to fetch billing account', Code.Internal);
    }
  }
};
