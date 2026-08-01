/**
 * SDK-free Stripe REST calls for direct web checkout. The server creates
 * customers, subscriptions, and Portal sessions while RevenueCat mirrors the
 * entitlement through receipt association. HTTP plumbing is in stripeHttp.ts.
 */

import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import {
  escapeSearchValue,
  prop,
  readString,
  resolveDeps,
  type StripeApiDeps,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";
import { getStripeSyncOption } from "./stripePrice";

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

interface StripeSubscriptionCheckoutInput {
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
const LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

/**
 * Finds the Stripe customer previously created for this buyer AND
 * organization, or creates one. Customers are deliberately scoped per
 * (user, org): the Billing Portal exposes everything on a customer, so a
 * buyer purchasing for several organizations must not have their
 * subscriptions pooled on one customer — org A's portal would expose (and
 * allow cancelling) org B's billing.
 */
export async function findOrCreateCustomer(
  input: { userId: string; organizationId: string },
  deps: StripeApiDeps = {},
): Promise<string | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const query = encodeURIComponent(
    `metadata['userId']:'${escapeSearchValue(input.userId)}' AND ` +
      `metadata['orgId']:'${escapeSearchValue(input.organizationId)}'`,
  );
  const found = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/customers/search?query=${query}&limit=1`,
    operation: "customer search",
  });
  const matches = prop(found, "data");
  if (Array.isArray(matches)) {
    const id = readString(prop(matches[0], "id"));
    if (id) {
      return id;
    }
  }

  const form = new URLSearchParams();
  form.set("metadata[userId]", input.userId);
  form.set("metadata[orgId]", input.organizationId);
  const created = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: "/v1/customers",
    operation: "customer create",
    form,
    // Search is eventually consistent, so a rapid retry can miss the customer
    // it just created; the scoped key makes the create itself return the
    // original instead — and beyond the idempotency window the search IS
    // consistent.
    idempotencyKey: `sync-customer:${input.userId}:${input.organizationId}`,
  });
  const customerId = readString(prop(created, "id"));
  if (!customerId) {
    // The create succeeded but the id could not be read: a provider failure
    // (502), never "unconfigured" — mirrors the subscription-create handling.
    throw new StripeApiError("customer create (unreadable id)", 502);
  }
  return customerId;
}

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
  const fetchedStatus = readString(prop(pending, "status"));
  const metadata = prop(pending, "metadata");
  const pendingAttemptId = readString(prop(metadata, "checkoutAttemptId"));
  if (fetchedStatus !== "incomplete") {
    return fetchedStatus && LIVE_SUBSCRIPTION_STATUSES.has(fetchedStatus)
      ? { kind: "conflict" }
      : { kind: "expired", checkoutAttemptId: pendingAttemptId };
  }
  const pendingUserId = readString(prop(metadata, "userId"));
  const items = prop(prop(pending, "items"), "data");
  const pendingItem = Array.isArray(items) ? items[0] : null;
  const pendingPriceId = readString(prop(prop(pendingItem, "price"), "id"));
  const pendingQuantity = prop(pendingItem, "quantity");
  if (
    pendingAttemptId === input.checkoutAttemptId &&
    pendingUserId === input.userId &&
    pendingPriceId === input.syncPriceId &&
    pendingQuantity === 1
  ) {
    const intent = parseCheckoutIntent(pending);
    // A matching pending checkout whose intent cannot be read is in an
    // unknown state; refusing beats risking a duplicate.
    return intent ? { kind: "resumed", intent } : { kind: "conflict" };
  }
  return { kind: "conflict" };
}

function parseCheckoutIntent(body: unknown): StripeCheckoutIntent | null {
  const subscriptionId = readString(prop(body, "id"));
  const clientSecret = readString(
    prop(prop(prop(body, "latest_invoice"), "payment_intent"), "client_secret"),
  );
  return subscriptionId && clientSecret
    ? { subscriptionId, clientSecret }
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
  const query = encodeURIComponent(
    `metadata['orgId']:'${escapeSearchValue(organizationId)}'`,
  );
  const found = await stripeRequest({
    ...request,
    method: "GET",
    // Stripe's max page size; an org would need >100 checkout attempts for
    // a live subscription to hide beyond this page.
    path: `/v1/subscriptions/search?query=${query}&limit=100`,
    operation: "subscription search",
  });
  const items = prop(found, "data");
  if (!Array.isArray(items)) {
    return { candidate: null, terminalAttemptWasUsed: false };
  }
  let terminalAttemptWasUsed = false;
  let pendingCandidate: { subscriptionId: string; status: string } | null =
    null;
  for (const item of items) {
    const status = readString(prop(item, "status"));
    const subscriptionId = readString(prop(item, "id"));
    if (!status || !subscriptionId) {
      continue;
    }
    if (LIVE_SUBSCRIPTION_STATUSES.has(status)) {
      return { candidate: { subscriptionId, status }, terminalAttemptWasUsed };
    }
    if (status === "incomplete") {
      if (pendingCandidate !== null) {
        // Multiple payable intents are already anomalous. Fail closed rather
        // than choosing one and creating alongside the other.
        return {
          candidate: { ...pendingCandidate, status: "ambiguous" },
          terminalAttemptWasUsed,
        };
      }
      pendingCandidate = { subscriptionId, status };
      continue;
    }
    const itemAttemptId = readString(
      prop(prop(item, "metadata"), "checkoutAttemptId"),
    );
    if (
      checkoutAttemptId !== undefined &&
      itemAttemptId === checkoutAttemptId
    ) {
      terminalAttemptWasUsed = true;
    }
  }
  return { candidate: pendingCandidate, terminalAttemptWasUsed };
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
  if (!candidate || candidate.status !== "incomplete") {
    return candidate !== null;
  }
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/subscriptions/${encodeURIComponent(candidate.subscriptionId)}`,
    operation: "subscription inspect",
  });
  const status = readString(prop(body, "status"));
  return (
    status === "incomplete" ||
    (status !== null && LIVE_SUBSCRIPTION_STATUSES.has(status))
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
  const query = encodeURIComponent(
    `metadata['orgId']:'${escapeSearchValue(organizationId)}'`,
  );
  // Stripe subscription search is eventually consistent, so a cancel/portal
  // fired in the seconds right after checkout may transiently find nothing and
  // no-op. That is strictly better than the stale-id 404 this replaced, and it
  // self-heals on the next attempt once the index catches up.
  const found = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/subscriptions/search?query=${query}&limit=100`,
    operation: "subscription search",
  });
  const items = prop(found, "data");
  if (!Array.isArray(items)) {
    return null;
  }
  // The first live subscription wins. An org holds at most one at a time — the
  // checkout conflict guard refuses a second — so there is nothing to
  // disambiguate; search order (not creation order) does not matter here.
  for (const item of items) {
    const status = readString(prop(item, "status"));
    const subscriptionId = readString(prop(item, "id"));
    if (!status || !subscriptionId || !LIVE_SUBSCRIPTION_STATUSES.has(status)) {
      continue;
    }
    const customer = prop(item, "customer");
    const customerId = readString(customer) ?? readString(prop(customer, "id"));
    // The search already filters on our own `orgId` metadata; re-confirm it
    // before returning a customer whose Billing Portal exposes ALL its
    // subscriptions, so a pooled customer can never leak another org's billing.
    const orgId = readString(prop(prop(item, "metadata"), "orgId"));
    if (customerId && orgId === organizationId) {
      return { subscriptionId, customerId };
    }
  }
  return null;
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
  const cancelAt = prop(body, "cancel_at");
  return { cancelAt: typeof cancelAt === "number" ? cancelAt : null };
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
  return readString(prop(body, "url"));
}

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
  return readString(prop(body, "url"));
}
