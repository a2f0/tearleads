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
  priceId: string;
  productName: string;
  currency: string;
  /** Amount in the currency's minor unit (e.g. cents); null if unpriced. */
  unitAmount: number | null;
  /** Billing interval (`month`/`year`…); null for a non-recurring price. */
  interval: string | null;
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
 * The Stripe Billing Portal URL for an organization's subscription, or null
 * when the org has no Stripe-store subscription to manage.
 */
export interface StripePortalResponse {
  portalUrl: string | null;
}

function isStripeSyncOption(value: unknown): value is StripeSyncOptionResponse {
  return (
    isPlainObject(value) &&
    hasNonEmptyStringProperty(value, "priceId") &&
    hasNonEmptyStringProperty(value, "productName") &&
    hasNonEmptyStringProperty(value, "currency") &&
    hasNullableNumberProperty(value, "unitAmount") &&
    hasNullableStringProperty(value, "interval")
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

export function isStripePortalResponse(
  value: unknown,
): value is StripePortalResponse {
  return isPlainObject(value) && hasNullableStringProperty(value, "portalUrl");
}
