/** The hosted Stripe Checkout Session: the off-site sync checkout. */

import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import { readProviderField } from "./providerPayloadSchema";
import type { StripeSubscriptionCheckoutInput } from "./stripeApi";
import { hostedUrlSchema } from "./stripeApiSchema";
import { resolveDeps, type StripeApiDeps, stripeRequest } from "./stripeHttp";
import { getStripeSyncOption } from "./stripePrice";

/**
 * Reduces a return URL to origin + path (dropping query and hash) so the hosted
 * checkout's `success_url`/`cancel_url` — and therefore its idempotency key —
 * are stable across an org's attempts even when transient client state varies
 * the full URL. Falls back to the input if it does not parse (already
 * origin-validated upstream). The buyer still lands on the billing page.
 */
function canonicalizeReturnUrl(returnUrl: string): string {
  try {
    const url = new URL(returnUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return returnUrl;
  }
}

/**
 * Creates a hosted Stripe Checkout Session for the sync subscription and
 * returns its URL. This is the off-site alternative to the inline Payment
 * Element: same product, same customer, and the SAME `orgId`/`userId` stamped
 * onto the resulting subscription (via `subscription_data[metadata]`) so the
 * `invoice.paid` webhook associates it with RevenueCat and the cancel/portal
 * resolver (`findLiveOrgSubscription`) can later find it — exactly like the
 * inline flow. Returns null when Stripe is unconfigured.
 *
 * The durable database attempt token scopes idempotency and rotates after the
 * Session expires. Return URLs are canonicalized so same-attempt retries keep
 * identical provider parameters.
 */
export async function createCheckoutSession(
  input: StripeSubscriptionCheckoutInput & {
    expiresAt: Date;
    returnUrl: string;
  },
  deps: StripeApiDeps = {},
): Promise<string | null> {
  const tier = getSyncBillingTierForSeatCount(input.seatQuantity);
  if (!tier) {
    throw new RangeError("Stripe checkout seat count has no available tier");
  }
  const option = await getStripeSyncOption(tier.id, deps);
  if (!option) {
    return null;
  }
  const syncPriceId = option.priceId;
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const expiresAt = Math.floor(input.expiresAt.getTime() / 1_000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new Error("Stripe Checkout expiration must be a valid date");
  }
  const canonicalReturnUrl = canonicalizeReturnUrl(input.returnUrl);
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", syncPriceId);
  form.set("line_items[0][quantity]", "1");
  form.set("customer", input.customerId);
  form.set("expires_at", String(expiresAt));
  form.set("success_url", canonicalReturnUrl);
  form.set("cancel_url", canonicalReturnUrl);
  form.set("subscription_data[metadata][userId]", input.userId);
  form.set("subscription_data[metadata][orgId]", input.organizationId);
  form.set("subscription_data[metadata][billingTier]", tier.id);
  form.set(
    "subscription_data[metadata][checkoutAttemptId]",
    input.checkoutAttemptId,
  );
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: "/v1/checkout/sessions",
    operation: "checkout session create",
    form,
    idempotencyKey: `checkout-session:${input.organizationId}:${input.checkoutAttemptId}`,
  });
  return readProviderField(hostedUrlSchema, body)?.url ?? null;
}
