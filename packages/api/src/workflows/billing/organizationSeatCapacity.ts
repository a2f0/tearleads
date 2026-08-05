import type { OrganizationBillingStatus } from "@tearleads/api-shared/schema";
import { getLargestSyncBillingTier } from "@tearleads/validators/billing";

interface BillingSeatCapacity {
  readonly seatCount: number;
  readonly status: OrganizationBillingStatus;
}

export function requiredLicensedSeatCount(
  billing: BillingSeatCapacity,
): number {
  if (billing.status === "trialing") {
    return getLargestSyncBillingTier().seatLimit;
  }
  return billing.seatCount;
}
