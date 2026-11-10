import { BILLING_ERROR_CODES } from "@tearleads/validators/billing";
import { ORG_MANAGER_LABELS } from "../labels";

/**
 * The inline checkout's copy, and the mapping from the server's refusals to
 * it. Roster-policy copy stays in `ORG_MANAGER_LABELS`, which the native plan
 * switcher shares.
 */
export const CHECKOUT_LABELS = {
  cancel: "Cancel checkout",
  emailHint:
    "Stripe uses this email to let you manage or cancel your subscription if you lose your Tearleads keys.",
  pay: "Pay and subscribe",
  paying: "Processing payment...",
  payOnStripe: "Prefer Stripe's page? Pay on Stripe instead",
  payOnStripeStarting: "Opening Stripe...",
  payOnStripeUnavailable: "Couldn't open Stripe checkout right now. Try again.",
  plan: "Plan",
  planUnavailable:
    "The plan you chose no longer fits your organization. Nothing was charged; choose a plan again.",
  starting: "Preparing checkout",
  startingDescription: "Loading the secure payment form.",
  title: "Checkout",
  unavailable: "The payment form could not be started. Try again in a moment.",
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
  return rosterPolicyMessage(error) ?? CHECKOUT_LABELS.unavailable;
}

/**
 * Whether the server refused the chosen plan because it is no longer offered
 * (the roster outgrew it, or its Price was retired). Nothing was charged; the
 * options must be reloaded.
 */
export function isCheckoutPlanUnavailable(error: unknown): boolean {
  return (
    billingErrorCode(error) === BILLING_ERROR_CODES.checkoutPlanUnavailable
  );
}

/** Maps any other refused or failed Pay to actionable copy. */
export function checkoutPayErrorMessage(error: unknown): string {
  return rosterPolicyMessage(error) ?? ORG_MANAGER_LABELS.failedSubscribe;
}
