/**
 * Read-only queries for cost model analysis
 *
 * Cross-references infrastructure costs with user billing data.
 */

import { query } from './postgres';

export interface OrganizationBillingSummary {
  organizationId: string;
  organizationName: string;
  entitlementStatus: string;
  activeProductId: string | null;
  periodEndsAt: Date | null;
  willRenew: boolean | null;
  createdAt: Date;
}

export interface AiUsageSummary {
  organizationId: string | null;
  organizationName: string | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  requestCount: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface UserCountSummary {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
}

/**
 * Get billing status for all organizations
 */
export async function getOrganizationBilling(): Promise<
  OrganizationBillingSummary[]
> {
  const sql = `
    SELECT
      oba.organization_id as "organizationId",
      o.name as "organizationName",
      oba.entitlement_status as "entitlementStatus",
      oba.active_product_id as "activeProductId",
      oba.period_ends_at as "periodEndsAt",
      oba.will_renew as "willRenew",
      oba.created_at as "createdAt"
    FROM organization_billing_accounts oba
    JOIN organizations o ON o.id = oba.organization_id
    ORDER BY oba.created_at DESC
  `;

  return query<OrganizationBillingSummary>(sql);
}

/**
 * Get AI usage summary by organization for a time period
 */
export async function getAiUsageSummary(
  startDate: Date,
  endDate: Date,
): Promise<AiUsageSummary[]> {
  const sql = `
    SELECT
      au.organization_id as "organizationId",
      o.name as "organizationName",
      SUM(au.prompt_tokens)::bigint as "totalPromptTokens",
      SUM(au.completion_tokens)::bigint as "totalCompletionTokens",
      SUM(au.total_tokens)::bigint as "totalTokens",
      COUNT(*)::bigint as "requestCount",
      $1::timestamp as "periodStart",
      $2::timestamp as "periodEnd"
    FROM ai_usage au
    LEFT JOIN organizations o ON o.id = au.organization_id
    WHERE au.created_at >= $1 AND au.created_at < $2
    GROUP BY au.organization_id, o.name
    ORDER BY "totalTokens" DESC
  `;

  return query<AiUsageSummary>(sql, [startDate, endDate]);
}

/**
 * Get user count summary
 */
export async function getUserCountSummary(): Promise<UserCountSummary> {
  const sql = `
    SELECT
      COUNT(*)::bigint as "totalUsers",
      COUNT(*) FILTER (WHERE disabled = false)::bigint as "activeUsers",
      COUNT(*) FILTER (WHERE disabled = true)::bigint as "disabledUsers"
    FROM users
  `;

  const results = await query<UserCountSummary>(sql);
  return (
    results[0] ?? { totalUsers: 0, activeUsers: 0, disabledUsers: 0 }
  );
}

/**
 * Get active subscriptions count by product
 */
export async function getSubscriptionsByProduct(): Promise<
  Array<{ productId: string; count: number; status: string }>
> {
  const sql = `
    SELECT
      active_product_id as "productId",
      entitlement_status as "status",
      COUNT(*)::bigint as "count"
    FROM organization_billing_accounts
    WHERE active_product_id IS NOT NULL
    GROUP BY active_product_id, entitlement_status
    ORDER BY "count" DESC
  `;

  return query(sql);
}
