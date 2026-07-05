import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

/**
 * Marks a test organization's billing as sync-enabled (`active`). Registration
 * provisions organizations as `local` (on-device only); the old per-user free
 * trial used to let every freshly registered user sync, so the shared test
 * registration helpers call this to preserve that "registered test user can
 * sync" default. Tests that specifically exercise the sync gate set the billing
 * back to `local` with {@link setTestOrganizationBillingLocal}.
 */
export async function enableTestOrganizationSync(
  organizationId: string,
): Promise<void> {
  await db
    .update(organizationBilling)
    .set({ status: "active", trialEndsAt: null, updatedAt: new Date() })
    .where(eq(organizationBilling.organizationId, organizationId));
}

/**
 * Puts a test organization into a `trialing` state whose `trialEndsAt` is
 * already in the past, WITHOUT running the lazy expiry flip. This is the state
 * the sync gate must treat as non-syncable in memory (an expired trial the
 * background flip has not yet disabled).
 */
export async function setTestOrganizationBillingExpiredTrial(
  organizationId: string,
): Promise<void> {
  await db
    .update(organizationBilling)
    .set({
      status: "trialing",
      trialEndsAt: new Date(Date.now() - 60_000),
      disabledAt: null,
      purgeAfter: null,
      updatedAt: new Date(),
    })
    .where(eq(organizationBilling.organizationId, organizationId));
}

export async function setTestOrganizationBillingLocal(
  organizationId: string,
): Promise<void> {
  await db
    .update(organizationBilling)
    .set({
      status: "local",
      trialEndsAt: null,
      disabledAt: null,
      purgeAfter: null,
      updatedAt: new Date(),
    })
    .where(eq(organizationBilling.organizationId, organizationId));
}
