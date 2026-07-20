import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

/**
 * The org-admin gate for the cancel and Billing Portal operations (issue
 * #1654). It also returns the billing row's stored `providerSubscriptionId`,
 * but cancel/portal deliberately ignore it: that column is the
 * RevenueCat-reported Stripe *item* id (`si_…`), not the `sub_…` those APIs
 * need, so they resolve the subscription from Stripe instead (see
 * `findLiveOrgSubscription`). The value is retained for any caller that wants
 * the stored id, and this workflow's real job is the admin check —
 * `requireDirectOrganizationAccess` throws for a non-admin, which is what keeps
 * a co-admin or multi-org purchaser from managing another org's billing.
 */
export async function runResolveOrgSubscriptionForAdminWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<{ providerSubscriptionId: string | null }> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });
    const [row] = await tx
      .select({
        providerSubscriptionId: organizationBilling.providerSubscriptionId,
      })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId))
      .limit(1);
    return { providerSubscriptionId: row?.providerSubscriptionId ?? null };
  });
}

/**
 * The admin gate plus a duplicate-purchase guard: an org whose billing row is
 * already `active` must not start another checkout — each confirmed checkout
 * creates a NEW Stripe subscription, so allowing it would double-bill the
 * org. The raw stored status is deliberate: only a provider revoke event
 * clears `active`, and until then a second subscription can only duplicate
 * the one the provider still reports.
 */
export async function runRequireCheckoutEligibleWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });
    const [row] = await tx
      .select({ status: organizationBilling.status })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId))
      .limit(1);
    if (row?.status === "active") {
      throw new OrganizationManagerError(
        "The organization already has an active subscription",
        409,
      );
    }
  });
}
