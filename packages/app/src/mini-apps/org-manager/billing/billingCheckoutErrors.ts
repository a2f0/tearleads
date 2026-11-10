import { BILLING_ERROR_CODES } from "@tearleads/validators/billing";
import { ORG_MANAGER_LABELS } from "../labels";

/** Inline-checkout copy beyond `ORG_MANAGER_LABELS`, which is at its size budget. */
export const CHECKOUT_LABELS = {
  priceChanged:
    "Your organization's roster changed, so its plan did too. Nothing was charged; review the new price and subscribe again.",
} as const;

function billingErrorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** Copy for the server's stable roster-policy refusals, if `error` is one. */
function rosterPolicyMessage(error: unknown): string | null {
  switch (billingErrorCode(error)) {
    case BILLING_ERROR_CODES.rosterOverCapacity:
      return ORG_MANAGER_LABELS.billingCheckoutOverCapacity;
    case BILLING_ERROR_CODES.checkoutNoActiveMembers:
      return ORG_MANAGER_LABELS.billingCheckoutNoMembers;
    default:
      return null;
  }
}

/** Maps a failure to load the checkout options to actionable copy. */
export function checkoutOptionErrorMessage(error: unknown): string {
  return (
    rosterPolicyMessage(error) ?? ORG_MANAGER_LABELS.billingCheckoutUnavailable
  );
}

/**
 * Whether Pay was refused because the plan the form showed no longer covers
 * the roster. Nothing was charged; the options must be reloaded.
 */
export function isCheckoutPriceChanged(error: unknown): boolean {
  return billingErrorCode(error) === BILLING_ERROR_CODES.checkoutPriceChanged;
}

/** Maps any other refused or failed Pay to actionable copy. */
export function checkoutPayErrorMessage(error: unknown): string {
  return rosterPolicyMessage(error) ?? ORG_MANAGER_LABELS.failedSubscribe;
}
