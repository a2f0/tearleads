import type { OrganizationBillingStatus } from "@tearleads/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import { OrganizationManagerError } from "../organizations/errors";

interface BillingSeatCapacity {
  readonly hasStripeSubscription: boolean;
  readonly providerProductId: string | null;
  readonly seatCount: number;
  readonly status: OrganizationBillingStatus;
}

export function requiredLicensedSeatCount(
  billing: BillingSeatCapacity,
  activeSeatCount: number,
): number {
  if (billing.status !== "active") {
    return activeSeatCount;
  }
  const nativeTier = getSyncBillingTierForNativeProduct(
    billing.providerProductId,
  );
  if (nativeTier) {
    if (activeSeatCount > nativeTier.seatLimit) {
      const memberLabel = nativeTier.seatLimit === 1 ? "member" : "members";
      throw new OrganizationManagerError(
        `Upgrade the subscription before adding more than ${nativeTier.seatLimit} ${memberLabel}`,
        409,
      );
    }
    return nativeTier.seatLimit;
  }
  if (billing.hasStripeSubscription) {
    const requiredTier = getSyncBillingTierForSeatCount(
      Math.max(1, activeSeatCount),
    );
    if (!requiredTier) {
      throw new OrganizationManagerError(
        "The organization exceeds the maximum subscription tier of 10 members",
        409,
      );
    }
    return requiredTier.seatLimit;
  }
  return Math.max(1, activeSeatCount);
}
