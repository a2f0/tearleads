import { isPlainObject } from "../isPlainObject";
import {
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
 * count used to choose the smallest tier that can cover the organization.
 */
export interface OrganizationBillingResponse {
  organizationId: string;
  activeMemberCount: number;
  status: OrganizationBillingStatus;
  trialEndsAt: string | null;
  provider: OrganizationBillingProvider | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  seatCount: number;
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
    hasNullableStringProperty(value, "disabledAt") &&
    hasNullableStringProperty(value, "purgeAfter")
  );
}

/**
 * The HTTP 402 body a sync write returns when its target organization cannot
 * sync (billing is `local`/lapsed). Carries the `organizationId` so the client
 * can route the user to that org's billing.
 */
export interface PaymentRequiredErrorResponse {
  error: string;
  organizationId: string;
}

export function isPaymentRequiredErrorResponse(
  value: unknown,
): value is PaymentRequiredErrorResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "error") &&
    hasStringProperty(value, "organizationId")
  );
}
