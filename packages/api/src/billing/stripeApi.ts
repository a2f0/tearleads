/**
 * SDK-free Stripe REST calls for direct web checkout. The server creates
 * the sync subscription here; customers, cancel/Portal, and the hosted
 * Checkout Session live in stripeCustomer.ts, stripeSubscriptionManagement.ts,
 * and stripeCheckoutSession.ts. RevenueCat mirrors the entitlement through
 * receipt association. HTTP plumbing is in stripeHttp.ts.
 */

import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import { readProviderField } from "./providerPayloadSchema";
import {
  checkoutIntentSchema,
  pendingCheckoutSchema,
  readCheckoutAttemptId,
  subscriptionSearchItemSchema,
  subscriptionStatusSchema,
} from "./stripeApiSchema";
import {
  resolveDeps,
  type StripeApiDeps,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";
import { getStripeSyncOption } from "./stripePrice";
import { findInStripeSubscriptionSearch } from "./stripeSubscriptionSearch";

export {
  isStripeCheckoutConfigured,
  type StripeApiDeps,
  StripeApiError,
} from "./stripeHttp";
export type { StripeSyncOption } from "./stripePrice";
export { getStripeSyncOption };

export interface StripeCheckoutIntent {
  readonly subscriptionId: string;
  /** PaymentIntent client secret the Payment Element confirms client-side. */
  readonly clientSecret: string;
}

export interface StripeSubscriptionCheckoutInput {
  checkoutAttemptId: string;
  customerId: string;
  userId: string;
  organizationId: string;
  seatQuantity: number;
}

/**
 * Outcome of asking for a checkout: `ready` carries the intent to confirm
 * (new, or an existing incomplete subscription being resumed); `conflict`
 * means Stripe already holds a live subscription for this org and creating
 * another would double-bill it.
 */
type StripeCheckoutOutcome =
  | { kind: "ready"; intent: StripeCheckoutIntent }
  | { kind: "conflict" };

/** Subscription statuses that mean the org is (or may become) billed. */
export const LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

/**
 * Resumes an incomplete checkout only for the same buyer, current price, and
 * requested seat quantity. A mismatch conflicts rather than risk paying a
 * removed admin's attempt, charging stale terms, or cancelling an in-flight
 * payment. The conflict clears when that attempt is paid or expires.
 */
async function resumePendingSubscription(input: {
  checkoutAttemptId: string;
  subscriptionId: string;
  userId: string;
  syncPriceId: string;
  fetchImpl: typeof fetch;
  secretKey: string;
}): Promise<
  | { kind: "resumed"; intent: StripeCheckoutIntent }
  | { kind: "conflict" }
  | { kind: "expired"; checkoutAttemptId: string | null }
> {
  const { fetchImpl, secretKey } = input;
  const pending = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path:
      `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}` +
      "?expand[]=latest_invoice.payment_intent",
    operation: "subscription resume",
  });
  // The search index is eventually consistent; the GET is authoritative. A
  // subscription that already left `incomplete` must not be resumed: live
  // means conflict, terminal means this is a fresh attempt.
  const fetchedStatus =
    readProviderField(subscriptionStatusSchema, pending)?.status ?? null;
  if (fetchedStatus !== "incomplete") {
    return fetchedStatus && LIVE_SUBSCRIPTION_STATUSES.has(fetchedStatus)
      ? { kind: "conflict" }
      : { kind: "expired", checkoutAttemptId: readCheckoutAttemptId(pending) };
  }
  const checkout = readProviderField(pendingCheckoutSchema, pending);
  if (
    checkout?.metadata.checkoutAttemptId === input.checkoutAttemptId &&
    checkout.metadata.userId === input.userId &&
    checkout.items.data[0].price.id === input.syncPriceId
  ) {
    const intent = parseCheckoutIntent(pending);
    // A matching pending checkout whose intent cannot be read is in an
    // unknown state; refusing beats risking a duplicate.
    return intent ? { kind: "resumed", intent } : { kind: "conflict" };
  }
  return { kind: "conflict" };
}

function parseCheckoutIntent(body: unknown): StripeCheckoutIntent | null {
  const intent = readProviderField(checkoutIntentSchema, body);
  return intent
    ? {
        subscriptionId: intent.id,
        clientSecret: intent.latest_invoice.payment_intent.client_secret,
      }
    : null;
}

/**
 * Finds an existing subscription bound to this org (our checkout stamps the
 * `orgId` metadata). This is the durable duplicate guard: the idempotency key
 * only covers Stripe's retention window, but a paid subscription whose
 * association webhooks were down for longer would otherwise be invisible to
 * a later checkout — Stripe itself is the store of record here.
 */
async function findOrgSubscription(
  organizationId: string,
  request: { fetchImpl: typeof fetch; secretKey: string },
  checkoutAttemptId?: string,
): Promise<{
  candidate: { subscriptionId: string; status: string } | null;
  terminalAttemptWasUsed: boolean;
}> {
  let terminalAttemptWasUsed = false;
  let pendingCandidate: { subscriptionId: string; status: string } | null =
    null;
  const decisiveCandidate = await findInStripeSubscriptionSearch(
    organizationId,
    request,
    (value) => {
      const item = readProviderField(subscriptionSearchItemSchema, value);
      if (!item) {
        return null;
      }
      const { id: subscriptionId, status } = item;
      if (LIVE_SUBSCRIPTION_STATUSES.has(status)) {
        return { subscriptionId, status };
      }
      if (status === "incomplete") {
        if (pendingCandidate !== null) {
          // Multiple payable intents are already anomalous. Fail closed rather
          // than choosing one and creating alongside the other.
          return { ...pendingCandidate, status: "ambiguous" };
        }
        pendingCandidate = { subscriptionId, status };
        return null;
      }
      const itemAttemptId = readCheckoutAttemptId(value);
      if (
        checkoutAttemptId !== undefined &&
        itemAttemptId === checkoutAttemptId
      ) {
        terminalAttemptWasUsed = true;
      }
      return null;
    },
  );
  return {
    candidate: decisiveCandidate ?? pendingCandidate,
    terminalAttemptWasUsed,
  };
}

/** True for a live or still-incomplete org subscription. */
export async function hasOpenOrgSubscription(
  organizationId: string,
  deps: StripeApiDeps = {},
): Promise<boolean> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) return false;
  const { candidate } = await findOrgSubscription(organizationId, {
    fetchImpl,
    secretKey,
  });
  if (candidate?.status !== "incomplete") {
    return candidate !== null;
  }
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/subscriptions/${encodeURIComponent(candidate.subscriptionId)}`,
    operation: "subscription inspect",
  });
  const status = readProviderField(subscriptionStatusSchema, body)?.status;
  return (
    status === "incomplete" ||
    (status !== undefined && LIVE_SUBSCRIPTION_STATUSES.has(status))
  );
}

/**
 * Creates the sync subscription in `default_incomplete` mode and returns the
 * first invoice's PaymentIntent client secret for the Payment Element to
 * confirm. The subscription carries `userId`/`orgId` metadata so the Stripe
 * webhook can associate the paid subscription with the right RevenueCat
 * customer and organization (see revenueCatStripeAssociation.ts).
 */
export async function createSyncSubscription(
  input: StripeSubscriptionCheckoutInput,
  deps: StripeApiDeps = {},
): Promise<StripeCheckoutOutcome | null> {
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

  const { candidate, terminalAttemptWasUsed } = await findOrgSubscription(
    input.organizationId,
    { fetchImpl, secretKey },
    input.checkoutAttemptId,
  );
  if (terminalAttemptWasUsed) {
    return { kind: "conflict" };
  }
  if (candidate && candidate.status !== "incomplete") {
    return { kind: "conflict" };
  }
  if (candidate) {
    const resumed = await resumePendingSubscription({
      checkoutAttemptId: input.checkoutAttemptId,
      subscriptionId: candidate.subscriptionId,
      userId: input.userId,
      syncPriceId,
      fetchImpl,
      secretKey,
    });
    if (resumed.kind === "resumed") {
      return { kind: "ready", intent: resumed.intent };
    }
    if (resumed.kind === "conflict") {
      return { kind: "conflict" };
    }
    if (resumed.checkoutAttemptId === input.checkoutAttemptId) {
      return { kind: "conflict" };
    }
  }

  const form = new URLSearchParams();
  form.set("customer", input.customerId);
  form.set("items[0][price]", syncPriceId);
  form.set("items[0][quantity]", "1");
  form.set("payment_behavior", "default_incomplete");
  form.set("payment_settings[save_default_payment_method]", "on_subscription");
  // Pin the subscription to cards. Without this the Payment Element offers
  // whatever the Stripe dashboard has enabled, and any redirect-based method
  // (Amazon Pay, Cash App, iDEAL) makes the client's `redirect: "if_required"`
  // confirm fail — the buyer would just see the generic failure label. Pinning
  // server-side keeps the offered methods matched to the flow we implement,
  // regardless of how the dashboard is configured.
  form.append("payment_settings[payment_method_types][]", "card");
  form.set("metadata[userId]", input.userId);
  form.set("metadata[orgId]", input.organizationId);
  form.set("metadata[billingTier]", tier.id);
  form.set("metadata[checkoutAttemptId]", input.checkoutAttemptId);
  form.append("expand[]", "latest_invoice.payment_intent");
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: "/v1/subscriptions",
    operation: "subscription create",
    form,
    // The database-issued token is shared with hosted checkout. Retries reuse
    // it; an expired local/provider attempt rotates it.
    idempotencyKey: `sync-sub:${input.organizationId}:${input.checkoutAttemptId}`,
  });
  const intent = parseCheckoutIntent(body);
  if (!intent) {
    // The subscription EXISTS (the create succeeded) but its intent could not
    // be read — and the idempotency key would replay this same response on a
    // retry. Surface it as a provider failure (502), never as "unconfigured",
    // so it is diagnosed rather than silently retried forever.
    throw new StripeApiError("subscription create (unreadable intent)", 502);
  }
  return { kind: "ready", intent };
}
