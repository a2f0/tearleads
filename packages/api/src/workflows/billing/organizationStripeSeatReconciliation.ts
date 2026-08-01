import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import { requestOrganizationStripeSeatSync } from "./stripeSeatState";

/** Reconciles the provider-specific seat outbox after local seat accounting. */
export async function reconcileOrganizationStripeSeatState(input: {
  readonly activeSeatCount: number;
  readonly executor: DatabaseSession;
  readonly hasStripeSubscription: boolean;
  readonly licensedSeatCount: number;
  readonly now: Date;
  readonly organizationId: string;
  readonly providerProductId: string | null;
  readonly seatPeriodKey: string;
}): Promise<void> {
  if (
    !input.hasStripeSubscription &&
    getSyncBillingTierForNativeProduct(input.providerProductId)
  ) {
    return;
  }
  const renewalTier = getSyncBillingTierForSeatCount(input.activeSeatCount);
  await requestOrganizationStripeSeatSync({
    desiredPaidCapacity: Math.max(
      input.licensedSeatCount,
      input.activeSeatCount,
    ),
    desiredRenewalQuantity: renewalTier?.seatLimit ?? input.activeSeatCount,
    desiredSeatPeriodKey: input.seatPeriodKey,
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
  });
}
