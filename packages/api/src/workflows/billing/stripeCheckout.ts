import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { requireDirectOrganizationAccess } from "../organizations/access";

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
