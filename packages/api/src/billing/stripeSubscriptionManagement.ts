/**
 * Cancel and Billing Portal calls for an organization's live Stripe
 * subscription, resolved from Stripe itself.
 */

import { readProviderField, stripeReferenceId } from "./providerPayloadSchema";
import { LIVE_SUBSCRIPTION_STATUSES } from "./stripeApi";
import {
  hostedUrlSchema,
  liveSubscriptionSearchItemSchema,
  subscriptionCancelSchema,
} from "./stripeApiSchema";
import { resolveDeps, type StripeApiDeps, stripeRequest } from "./stripeHttp";
import { findInStripeSubscriptionSearch } from "./stripeSubscriptionSearch";

/**
 * Finds the organization's LIVE Stripe subscription by searching on the
 * `orgId` metadata set at creation, returning the ids cancel/portal need.
 *
 * This is the authoritative resolver, NOT the billing row's
 * `providerSubscriptionId`: that column is written only by the RevenueCat
 * webhook, and for a Stripe purchase RevenueCat reports the subscription ITEM
 * id (`si_…`), never the `sub_…` that Stripe's cancel and Billing Portal APIs
 * require. Searching Stripe directly also self-heals subscriptions bought
 * before this resolver existed.
 *
 * `incomplete` does not count — nothing is billing yet, so there is nothing to
 * cancel or manage. Returns null when unconfigured or no live subscription
 * belongs to the org.
 */
export async function findLiveOrgSubscription(
  organizationId: string,
  deps: StripeApiDeps = {},
): Promise<{ subscriptionId: string; customerId: string } | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  // Stripe subscription search is eventually consistent, so a cancel/portal
  // fired in the seconds right after checkout may transiently find nothing and
  // no-op. That is strictly better than the stale-id 404 this replaced, and it
  // self-heals on the next attempt once the index catches up.
  // The first live subscription wins. An org holds at most one at a time — the
  // checkout conflict guard refuses a second — so there is nothing to
  // disambiguate; search order (not creation order) does not matter here.
  return findInStripeSubscriptionSearch(
    organizationId,
    { fetchImpl, secretKey },
    (value) => {
      const item = readProviderField(liveSubscriptionSearchItemSchema, value);
      // The search already filters on our own `orgId` metadata; re-confirm it
      // before returning a customer whose Billing Portal exposes ALL its
      // subscriptions, so a pooled customer can never leak another org's billing.
      if (
        !item ||
        !LIVE_SUBSCRIPTION_STATUSES.has(item.status) ||
        item.metadata.orgId !== organizationId
      ) {
        return null;
      }
      return {
        subscriptionId: item.id,
        customerId: stripeReferenceId(item.customer),
      };
    },
  );
}

/**
 * Schedules a subscription to end when the paid period closes.
 *
 * `cancel_at_period_end` rather than an immediate delete: the buyer keeps the
 * sync they already paid for, and RevenueCat's lifecycle tracking flips the
 * entitlement when the period actually closes — through the same webhook path
 * a lapsed renewal takes, so no separate revocation logic is needed.
 *
 * Returns the resulting cancellation timestamp (Unix seconds) so the panel can
 * say when access ends, or null when Stripe is unconfigured.
 */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
  deps: StripeApiDeps = {},
): Promise<{ cancelAt: number | null } | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const form = new URLSearchParams();
  form.set("cancel_at_period_end", "true");
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    operation: "subscription cancel",
    form,
  });
  return {
    cancelAt:
      readProviderField(subscriptionCancelSchema, body)?.cancel_at ?? null,
  };
}

/**
 * Creates a Billing Portal session for a customer; the caller supplies the
 * return URL (the billing panel's origin). Returns the hosted portal URL.
 */
export async function createPortalSession(
  input: { customerId: string; returnUrl: string },
  deps: StripeApiDeps = {},
): Promise<string | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const form = new URLSearchParams();
  form.set("customer", input.customerId);
  form.set("return_url", input.returnUrl);
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: "/v1/billing_portal/sessions",
    operation: "portal session create",
    form,
  });
  return readProviderField(hostedUrlSchema, body)?.url ?? null;
}
