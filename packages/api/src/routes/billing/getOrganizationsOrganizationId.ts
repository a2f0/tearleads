import type {
  OrganizationBillingAccountResponse,
  OrganizationBillingEntitlementStatus
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

// COMPLIANCE_SENTINEL: TL-PAY-005 | control=billing-data-authorization

type MembershipRow = {
  organization_id: string;
};

type BillingAccountRow = {
  organization_id: string;
  revenuecat_app_user_id: string;
  entitlement_status: OrganizationBillingEntitlementStatus;
  active_product_id: string | null;
  period_ends_at: Date | null;
  will_renew: boolean | null;
  last_webhook_event_id: string | null;
  last_webhook_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * @openapi
 * /billing/organizations/{organizationId}:
 *   get:
 *     summary: Get organization billing status
 *     description: Returns RevenueCat-backed billing state for an organization the caller belongs to.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organization billing account
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Billing account not found
 *       500:
 *         description: Server error
 */
const getOrganizationsOrganizationidHandler = async (
  req: Request<{ organizationId: string }>,
  res: Response
): Promise<void> => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const organizationId = req.params.organizationId;

    const membershipResult = await pool.query<MembershipRow>(
      `SELECT organization_id
       FROM user_organizations
       WHERE user_id = $1
         AND organization_id = $2
       LIMIT 1`,
      [claims.sub, organizationId]
    );

    if (!membershipResult.rows[0]) {
      res.status(403).json({ error: 'Forbidden' });
      return;
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
      res.status(404).json({ error: 'Billing account not found' });
      return;
    }

    const response: OrganizationBillingAccountResponse = {
      billingAccount: {
        organizationId: row.organization_id,
        revenueCatAppUserId: row.revenuecat_app_user_id,
        entitlementStatus: row.entitlement_status,
        activeProductId: row.active_product_id,
        periodEndsAt: row.period_ends_at?.toISOString() ?? null,
        willRenew: row.will_renew,
        lastWebhookEventId: row.last_webhook_event_id,
        lastWebhookAt: row.last_webhook_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Failed to fetch billing account:', error);
    res.status(500).json({ error: 'Failed to fetch billing account' });
  }
};

export function registerGetOrganizationsOrganizationidRoute(
  routeRouter: RouterType
): void {
  routeRouter.get(
    '/organizations/:organizationId',
    getOrganizationsOrganizationidHandler
  );
}
