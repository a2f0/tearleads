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
  if (getSyncBillingTierForNativeProduct(billing.providerProductId)) {
    if (activeSeatCount > billing.seatCount) {
      const memberLabel = billing.seatCount === 1 ? "member" : "members";
      throw new OrganizationManagerError(
        `Upgrade the subscription before adding more than ${billing.seatCount} ${memberLabel}`,
        409,
      );
    }
    return billing.seatCount;
  }
  return Math.max(1, activeSeatCount);
}
