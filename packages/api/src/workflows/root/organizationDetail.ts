import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import type { RootOrganizationDetailResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { serializeOrganizationBillingHistory } from "../../billing/organizationBilling";
import { loadOrganizationBillingHistory } from "../billing/organizationBillingHistory";
import { getRootOrganization } from "./organizations";

async function loadBilling(executor: DatabaseSession, organizationId: string) {
  const [row] = await executor
    .select()
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);
  if (!row) return null;
  return {
    status: row.status,
    provider: row.provider,
    seatCount: row.seatCount,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    currentPeriodStartsAt: row.currentPeriodStartsAt?.toISOString() ?? null,
    currentPeriodEndsAt: row.currentPeriodEndsAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    purgeAfter: row.purgeAfter?.toISOString() ?? null,
    purgedAt: row.purgedAt?.toISOString() ?? null,
    providerCustomerId: row.providerCustomerId,
    providerSubscriptionId: row.providerSubscriptionId,
    providerProductId: row.providerProductId,
    providerTransactionId: row.providerTransactionId,
    entitlementId: row.entitlementId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
async function loadStripe(executor: DatabaseSession, organizationId: string) {
  const [row] = await executor
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId))
    .limit(1);
  if (!row) return null;
  return {
    customerId: row.customerId,
    subscriptionId: row.subscriptionId,
    subscriptionItemId: row.subscriptionItemId,
    priceId: row.priceId,
    lastInvoiceId: row.lastInvoiceId,
    desiredPaidCapacity: row.desiredPaidCapacity,
    desiredRenewalQuantity: row.desiredRenewalQuantity,
    appliedPaidCapacity: row.appliedPaidCapacity,
    observedQuantity: row.observedQuantity,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
  };
}
/** Operator reads expose persisted state and never reconcile or mutate billing. */
export function loadRootOrganizationDetail(
  db: ApiDatabase,
  organizationId: string,
): Promise<RootOrganizationDetailResponse | null> {
  return db.transaction(async (tx) => {
    const organization = await getRootOrganization(tx, organizationId);
    if (!organization) return null;
    return {
      organization,
      billing: await loadBilling(tx, organizationId),
      stripe: await loadStripe(tx, organizationId),
      history: serializeOrganizationBillingHistory(
        organizationId,
        await loadOrganizationBillingHistory(tx, organizationId),
      ).entries,
    };
  });
}
