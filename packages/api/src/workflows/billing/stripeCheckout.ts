import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

/**
 * Access gate for the direct Stripe checkout routes (issue #1654): starting a
 * checkout or opening the billing portal for an organization requires the
 * session user to be an admin of that organization. Throws
 * `OrganizationManagerError` (mapped to its HTTP response by the route)
 * otherwise.
 */
export async function runRequireBillingAdminWorkflow(
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
