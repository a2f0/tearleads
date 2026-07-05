import { isPlainObject } from "../isPlainObject";
import { hasNullableStringProperty, hasStringProperty } from "../util";

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
 * trialing, `currentPeriodEndsAt` while a paid subscription is active.
 */
export interface OrganizationBillingResponse {
  organizationId: string;
  status: OrganizationBillingStatus;
  trialEndsAt: string | null;
  provider: OrganizationBillingProvider | null;
  currentPeriodEndsAt: string | null;
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

export function isOrganizationBillingResponse(
  value: unknown,
): value is OrganizationBillingResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "status") &&
    isOrganizationBillingStatus(value.status) &&
    hasNullableStringProperty(value, "trialEndsAt") &&
    hasNullableStringProperty(value, "provider") &&
    (value.provider === null ||
      isOrganizationBillingProvider(value.provider)) &&
    hasNullableStringProperty(value, "currentPeriodEndsAt") &&
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
