import { isSyncBillingTierId, type SyncBillingTierId } from "../billing";
import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNonEmptyStringProperty,
  hasNullableNumberProperty,
  hasNullableStringProperty,
} from "../util";

/**
 * Responses for the direct Stripe checkout (issue #1654): the web client runs
 * the payment form itself against our own Stripe account, while RevenueCat
 * still owns entitlements. Amounts stay in the currency's MINOR unit exactly
 * as Stripe reports them — the client formats, the server never rounds.
 */

/** One purchasable sync option, shaped for display in the billing panel. */
export interface StripeSyncOptionResponse {
  tierId: SyncBillingTierId;
  seatLimit: number;
  priceId: string;
  productName: string;
  currency: string;
  /** Amount in the currency's minor unit (e.g. cents); null if unpriced. */
  unitAmount: number | null;
  /** Billing interval (`month`/`year`…); null for a non-recurring price. */
  interval: string | null;
  /** Number of intervals in one billing period; null when Stripe omits it. */
  intervalCount: number | null;
}

export interface StripeCheckoutOptionsResponse {
  options: StripeSyncOptionResponse[];
}

/**
 * What the Payment Element needs to confirm a purchase. `clientSecret` is a
 * PaymentIntent secret — safe for the browser, scoped to this one payment.
 */
export interface StripeCheckoutIntentResponse {
  subscriptionId: string;
  clientSecret: string;
}

/**
 * The moment the org's sync access ends, as Unix seconds. Null is a normal
 * answer: Stripe omits `cancel_at` for an already-cancelling subscription, and
 * the cancellation still took effect.
 */
export interface StripeCancelResponse {
  cancelAt: number | null;
}

export function isStripeCancelResponse(
  value: unknown,
): value is StripeCancelResponse {
  return isPlainObject(value) && hasNullableNumberProperty(value, "cancelAt");
}

/**
 * The hosted Stripe Checkout page URL, or null when the integration is
 * unconfigured or the org is not eligible (already active). The client
 * navigates to `url`; a null simply offers no external-pay link.
 */
export interface StripeCheckoutSessionResponse {
  url: string | null;
}

export function isStripeCheckoutSessionResponse(
  value: unknown,
): value is StripeCheckoutSessionResponse {
  return isPlainObject(value) && hasNullableStringProperty(value, "url");
}

function isStripeSyncOption(value: unknown): value is StripeSyncOptionResponse {
  if (!isPlainObject(value)) {
    return false;
  }
  const { intervalCount, seatLimit, tierId } = value;
  return (
    isSyncBillingTierId(tierId) &&
    typeof seatLimit === "number" &&
    Number.isSafeInteger(seatLimit) &&
    seatLimit > 0 &&
    hasNonEmptyStringProperty(value, "priceId") &&
    hasNonEmptyStringProperty(value, "productName") &&
    hasNonEmptyStringProperty(value, "currency") &&
    hasNullableNumberProperty(value, "unitAmount") &&
    hasNullableStringProperty(value, "interval") &&
    (intervalCount === null ||
      (typeof intervalCount === "number" &&
        Number.isSafeInteger(intervalCount) &&
        intervalCount > 0))
  );
}

export function isStripeCheckoutOptionsResponse(
  value: unknown,
): value is StripeCheckoutOptionsResponse {
  return (
    isPlainObject(value) &&
    hasArrayProperty(value, "options") &&
    value.options.every(isStripeSyncOption)
  );
}

export function isStripeCheckoutIntentResponse(
  value: unknown,
): value is StripeCheckoutIntentResponse {
  return (
    isPlainObject(value) &&
    // Both must be non-empty: an empty secret cannot confirm a payment, and
    // an empty subscription id cannot be associated with RevenueCat.
    hasNonEmptyStringProperty(value, "subscriptionId") &&
    hasNonEmptyStringProperty(value, "clientSecret")
  );
}
