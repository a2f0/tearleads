import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingLifecycleEvents,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

/**
 * Puts a test organization into a `trialing` state whose `trialEndsAt` is
 * already in the past, WITHOUT running the lazy expiry flip. This is the state
 * the sync gate must treat as non-syncable in memory (an expired trial the
 * background flip has not yet disabled).
 */
export async function setTestOrganizationBillingExpiredTrial(
  organizationId: string,
): Promise<void> {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() - 60_000);
  await db
    .update(organizationBilling)
    .set({
      status: "trialing",
      trialEndsAt,
      trialExpiryAttemptCount: 0,
      trialExpiryLastError: null,
      trialExpiryNextAttemptAt: trialEndsAt,
      seatCount: 0,
      disabledAt: null,
      purgeAfter: null,
      updatedAt: now,
    })
    .where(eq(organizationBilling.organizationId, organizationId));
}

export async function setTestOrganizationBillingLocal(
  organizationId: string,
): Promise<void> {
  await db
    .delete(organizationBillingLifecycleEvents)
    .where(
      eq(organizationBillingLifecycleEvents.organizationId, organizationId),
    );
  await db
    .delete(organizationBillingSeatAssignments)
    .where(
      eq(organizationBillingSeatAssignments.organizationId, organizationId),
    );
  await db
    .delete(organizationBillingSeatEvents)
    .where(eq(organizationBillingSeatEvents.organizationId, organizationId));
  await db
    .update(organizationBilling)
    .set({
      status: "local",
      trialEndsAt: null,
      trialExpiryAttemptCount: 0,
      trialExpiryLastError: null,
      trialExpiryNextAttemptAt: null,
      seatCount: 0,
      disabledAt: null,
      purgeAfter: null,
      updatedAt: new Date(),
    })
    .where(eq(organizationBilling.organizationId, organizationId));
}
