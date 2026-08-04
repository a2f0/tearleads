import type { OrganizationBillingStatus } from "@tearleads/api-shared/schema";
import {
  BILLING_ERROR_CODES,
  getLargestSyncBillingTier,
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import { OrganizationManagerError } from "../organizations/errors";

interface BillingSeatCapacity {
  readonly hasStripeSubscription: boolean;
  readonly providerProductId: string | null;
  readonly status: OrganizationBillingStatus;
}

function assertRosterWithinLargestTier(
  activeSeatCount: number,
  previousActiveSeatCount?: number,
): void {
  const activeSeatCountIsValid =
    Number.isSafeInteger(activeSeatCount) && activeSeatCount >= 0;
  if (
    activeSeatCountIsValid &&
    (activeSeatCount <= getLargestSyncBillingTier().seatLimit ||
      (previousActiveSeatCount !== undefined &&
        activeSeatCount <= previousActiveSeatCount))
  ) {
    return;
  }
  throw new OrganizationManagerError(
    "The organization exceeds the maximum subscription tier of 10 members",
    409,
    BILLING_ERROR_CODES.rosterOverCapacity,
  );
}

function canonicalTierSeatCount(
  activeSeatCount: number,
  previousActiveSeatCount?: number,
): number {
  const tier = getSyncBillingTierForSeatCount(Math.max(1, activeSeatCount));
  if (tier) {
    return tier.seatLimit;
  }
  assertRosterWithinLargestTier(activeSeatCount, previousActiveSeatCount);
  return getLargestSyncBillingTier().seatLimit;
}

export function requiredLicensedSeatCount(
  billing: BillingSeatCapacity,
  activeSeatCount: number,
  previousActiveSeatCount?: number,
): number {
  if (billing.status !== "active" && billing.status !== "trialing") {
    return activeSeatCount;
  }
  if (billing.status === "trialing") {
    assertRosterWithinLargestTier(activeSeatCount, previousActiveSeatCount);
    return getLargestSyncBillingTier().seatLimit;
  }
  const nativeTier = billing.hasStripeSubscription
    ? null
    : getSyncBillingTierForNativeProduct(billing.providerProductId);
  if (nativeTier) {
    if (
      activeSeatCount > nativeTier.seatLimit &&
      (previousActiveSeatCount === undefined ||
        activeSeatCount > previousActiveSeatCount)
    ) {
      const memberLabel = nativeTier.seatLimit === 1 ? "member" : "members";
      throw new OrganizationManagerError(
        `Upgrade the subscription before adding more than ${nativeTier.seatLimit} ${memberLabel}`,
        409,
        BILLING_ERROR_CODES.nativeTierUpgradeRequired,
      );
    }
    return nativeTier.seatLimit;
  }
  return canonicalTierSeatCount(activeSeatCount, previousActiveSeatCount);
}
