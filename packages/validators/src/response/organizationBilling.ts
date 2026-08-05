import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasBooleanProperty,
  hasNullableNumberProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";

export type OrganizationBillingStatus =
  | "local"
  | "trialing"
  | "active"
  | "past_due"
  | "disabled"
  | "deleting"
  | "purged";

export type OrganizationBillingProvider = "revenuecat";

/**
 * Per-organization sync-billing snapshot returned to the client. Sync is the one
 * paid feature; `status` decides whether the organization may sync at all. A
 * `local` organization is free and on-device only. `trialEndsAt` is set while
 * trialing, `currentPeriodStartsAt`/`currentPeriodEndsAt` while a paid
 * subscription is active, and `seatCount` tracks licensed seats in that paid
 * period. `activeMemberCount` is the server-authoritative signed Members-group
 * count used by the plan switcher; assigned seat fields expose the stable
 * per-user subset that may sync within the licensed capacity.
 */
export interface OrganizationBillingResponse {
  organizationId: string;
  activeMemberCount: number;
  assignedSeatCount: number;
  assignedUserIds: string[];
  currentUserHasSyncSeat: boolean;
  status: OrganizationBillingStatus;
  trialEndsAt: string | null;
  provider: OrganizationBillingProvider | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  seatCount: number;
  /** Destination native tier while the store has scheduled but not effected a change. */
  pendingSeatCount: number | null;
  disabledAt: string | null;
  purgeAfter: string | null;
}

export function isOrganizationBillingStatus(
  value: unknown,
): value is OrganizationBillingStatus {
  return (
    value === "local" ||
    value === "trialing" ||
    value === "active" ||
    value === "past_due" ||
    value === "disabled" ||
    value === "deleting" ||
    value === "purged"
  );
}

export function isOrganizationBillingProvider(
  value: unknown,
): value is OrganizationBillingProvider {
  return value === "revenuecat";
}

function isSeatCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isOrganizationBillingResponse(
  value: unknown,
): value is OrganizationBillingResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasNumberProperty(value, "activeMemberCount") &&
    isSeatCount(value.activeMemberCount) &&
    hasNumberProperty(value, "assignedSeatCount") &&
    isSeatCount(value.assignedSeatCount) &&
    hasArrayProperty(value, "assignedUserIds") &&
    value.assignedUserIds.every(
      (userId) => typeof userId === "string" && userId.length > 0,
    ) &&
    value.assignedSeatCount === value.assignedUserIds.length &&
    hasBooleanProperty(value, "currentUserHasSyncSeat") &&
    hasStringProperty(value, "status") &&
    isOrganizationBillingStatus(value.status) &&
    hasNullableStringProperty(value, "trialEndsAt") &&
    hasNullableStringProperty(value, "provider") &&
    (value.provider === null ||
      isOrganizationBillingProvider(value.provider)) &&
    hasNullableStringProperty(value, "currentPeriodStartsAt") &&
    hasNullableStringProperty(value, "currentPeriodEndsAt") &&
    hasNumberProperty(value, "seatCount") &&
    isSeatCount(value.seatCount) &&
    hasNullableNumberProperty(value, "pendingSeatCount") &&
    (value.pendingSeatCount === null ||
      (isSeatCount(value.pendingSeatCount) && value.pendingSeatCount > 0)) &&
    hasNullableStringProperty(value, "disabledAt") &&
    hasNullableStringProperty(value, "purgeAfter")
  );
}

/**
 * The HTTP 402 body a sync write returns when its target organization cannot
 * sync. Carries the target organization and whether billing or the caller's
 * seat assignment blocked the write.
 */
export interface PaymentRequiredErrorResponse {
  error: string;
  organizationId: string;
  reason: "billing_inactive" | "sync_seat_unassigned";
}

export function isPaymentRequiredErrorResponse(
  value: unknown,
): value is PaymentRequiredErrorResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "error") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "reason") &&
    (value.reason === "billing_inactive" ||
      value.reason === "sync_seat_unassigned")
  );
}
