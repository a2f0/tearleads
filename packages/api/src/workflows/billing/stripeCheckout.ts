import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

/**
 * Admin-gated read of the organization's stored provider subscription id
 * (issue #1654). The Billing Portal must manage THE ORGANIZATION'S
 * subscription — resolving from the caller instead would hand a co-admin a
 * fresh empty customer, or hand a multi-org purchaser a portal spanning
 * other organizations' subscriptions.
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
