import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import { requestOrganizationStripeSeatSync } from "./stripeSeatState";

/** Reconciles the provider-specific seat outbox after local seat accounting. */
export async function reconcileOrganizationStripeSeatState(input: {
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
  await requestOrganizationStripeSeatSync({
    desiredPaidCapacity: input.licensedSeatCount,
    desiredRenewalQuantity: input.licensedSeatCount,
    desiredSeatPeriodKey: input.seatPeriodKey,
    executor: input.executor,
    now: input.now,
    organizationId: input.organizationId,
  });
}
