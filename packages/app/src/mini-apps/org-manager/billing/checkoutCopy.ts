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

/** Copy for changing an active Stripe subscription's plan. */
export const PLAN_CHANGE_LABELS = {
  cancel: "Cancel",
  changed: {
    kept: "Your plan will renew unchanged.",
    scheduled: "The smaller plan starts at renewal.",
    upgraded: "Upgraded. The larger plan applies now.",
  },
  confirmDowngrade: "Schedule downgrade",
  confirmKeep: "Keep this plan",
  confirmUpgrade: "Pay and upgrade",
  downgradeNotice: (name: string, renewsOn: string) =>
    `Switch to ${name} at renewal on ${renewsOn}? You keep your current plan until then, with no credit for the rest of this period.`,
  failed: "The plan could not be changed. Try again.",
  keepNotice: (name: string) =>
    `Keep ${name}? The smaller plan scheduled for renewal is cancelled.`,
  keepPlan: "Keep plan",
  paymentFailed:
    "The payment didn't go through, so nothing changed. Update your card with Manage billing, then try again.",
  scheduledCapacityConflict:
    "The plan scheduled for renewal cannot cover the current roster. Keep your current plan or choose a larger one.",
  timing:
    "Upgrades charge the prorated difference for the rest of this period now and apply once paid. Downgrades take effect at renewal, with no credit for the rest of this period.",
  upgradeNotice: (name: string) =>
    `Upgrade to ${name}? Your card is charged the prorated difference for the rest of this period now, and the larger plan applies once the payment goes through.`,
} as const;

/**
 * Maps a refused plan change to copy: a declined upgrade, or the server's own
 * reason a plan cannot be chosen now (it names what to do, such as removing
 * members first).
 */
export function planChangeErrorMessage(error: unknown): string {
  switch (billingErrorCode(error)) {
    case BILLING_ERROR_CODES.planChangePaymentFailed:
      return PLAN_CHANGE_LABELS.paymentFailed;
    case BILLING_ERROR_CODES.planChangeUnavailable:
      return error instanceof Error && error.message
        ? error.message
        : PLAN_CHANGE_LABELS.failed;
    default:
      return PLAN_CHANGE_LABELS.failed;
  }
}
