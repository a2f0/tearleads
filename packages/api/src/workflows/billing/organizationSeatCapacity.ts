import type {
  OrganizationBillingSeatEventType,
  OrganizationBillingStatus,
} from "@tearleads/api-shared/schema";
import {
  getLargestSyncBillingTier,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";

interface BillingSeatCapacity {
  readonly seatCount: number;
  readonly status: OrganizationBillingStatus;
}

export function requiredLicensedSeatCount(
  billing: BillingSeatCapacity,
  activeMemberCount: number,
): number {
  if (billing.status === "trialing") {
    return getLargestSyncBillingTier().seatLimit;
  }
  if (billing.status === "active" && billing.seatCount === 0) {
    return (
      getSyncBillingTierForSeatCount(Math.max(1, activeMemberCount)) ??
      getLargestSyncBillingTier()
    ).seatLimit;
  }
  return billing.seatCount;
}

export function licensedSeatCountChangeEventType(
  previousSeatCount: number,
  nextSeatCount: number,
): OrganizationBillingSeatEventType {
  if (previousSeatCount === 0) return "licensed_seat_count_initialized";
  return nextSeatCount > previousSeatCount
    ? "licensed_seat_count_increased"
    : "licensed_seat_count_decreased";
}
