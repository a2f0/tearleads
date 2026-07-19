/**
 * Minimal outbound Stripe REST client for the direct web checkout path
 * (issue #1654): the server creates the customer/subscription and the Billing
 * Portal session on OUR Stripe account, while RevenueCat stays the entitlement
 * system via receipt association (see revenueCatStripeAssociation.ts).
 *
 * Deliberately SDK-free, mirroring revenueCatApi.ts: the four calls used here
 * are plain form-encoded HTTP, and an injectable fetch keeps every caller
 * unit-testable without network.
 */

/** Environment variable holding the Stripe secret key (`sk_test_…`/`sk_live_…`). */
const STRIPE_SECRET_KEY_ENV = "STRIPE_SECRET_KEY";
/** Environment variable holding the sync subscription's Stripe price id. */
const STRIPE_SYNC_PRICE_ID_ENV = "STRIPE_SYNC_PRICE_ID";

const STRIPE_API_ORIGIN = "https://api.stripe.com";
/**
 * Pin the API version on every outbound call so response shapes do not change
 * under us when the Stripe account's default version is upgraded.
 */
const STRIPE_API_VERSION = "2024-06-20";
/** Fail rather than hang if Stripe stalls mid-request. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface StripeApiDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

/** A Stripe request failed; `status` is the HTTP status Stripe returned. */
export class StripeApiError extends Error {
  readonly status: number;
  constructor(operation: string, status: number) {
    super(`Stripe ${operation} failed with status ${status}`);
    this.name = "StripeApiError";
    this.status = status;
  }
}

/** The sync subscription option shaped for display in the billing panel. */
export interface StripeSyncOption {
  readonly priceId: string;
  readonly productName: string;
  readonly currency: string;
  /** Amount in the currency's minor unit (e.g. cents), as Stripe reports it. */
  readonly unitAmount: number | null;
  /** Billing interval (`month`/`year`…), null for a non-recurring price. */
  readonly interval: string | null;
}

export interface StripeCheckoutIntent {
  readonly subscriptionId: string;
  /** PaymentIntent client secret the Payment Element confirms client-side. */
  readonly clientSecret: string;
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

function readEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function resolveDeps(deps: StripeApiDeps): {
  fetchImpl: typeof fetch;
  secretKey: string | null;
  syncPriceId: string | null;
} {
  const env = deps.env ?? process.env;
  return {
    fetchImpl: deps.fetchImpl ?? fetch,
    secretKey: readEnv(env, STRIPE_SECRET_KEY_ENV),
    syncPriceId: readEnv(env, STRIPE_SYNC_PRICE_ID_ENV),
  };
}

/** True when both the secret key and the sync price are configured. */
export function isStripeCheckoutConfigured(deps: StripeApiDeps = {}): boolean {
  const { secretKey, syncPriceId } = resolveDeps(deps);
  return secretKey !== null && syncPriceId !== null;
}

async function stripeRequest(input: {
  fetchImpl: typeof fetch;
  secretKey: string;
  method: "GET" | "POST";
  path: string;
  operation: string;
  form?: URLSearchParams;
  idempotencyKey?: string;
}): Promise<unknown> {
  const response = await input.fetchImpl(`${STRIPE_API_ORIGIN}${input.path}`, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(input.idempotencyKey
        ? { "Idempotency-Key": input.idempotencyKey }
        : {}),
      ...(input.form
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    ...(input.form ? { body: input.form.toString() } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new StripeApiError(input.operation, response.status);
  }
  return response.json();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Reads one property from an unknown value when it is a plain object. The key
 * is a parameter, which keeps both tsc's no-index-signature-dot-access rule
 * and biome's prefer-dot-access rule satisfied (neither fires on a variable
 * key).
 */
function prop(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, unknown> = { ...value };
  return record[key];
}

/**
 * Fetches the configured sync price (with its product expanded) shaped for
 * display. Returns null when the integration is not configured; throws
 * {@link StripeApiError} on a failed request so a route can 502 rather than
 * show an empty option list for a transient failure.
 */
export async function getStripeSyncOption(
  deps: StripeApiDeps = {},
): Promise<StripeSyncOption | null> {
  const { fetchImpl, secretKey, syncPriceId } = resolveDeps(deps);
  if (!secretKey || !syncPriceId) {
    return null;
  }
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/prices/${encodeURIComponent(syncPriceId)}?expand[]=product`,
    operation: "price lookup",
  });
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const unitAmount = prop(body, "unit_amount");
  return {
    priceId: readString(prop(body, "id")) ?? syncPriceId,
    productName: readString(prop(prop(body, "product"), "name")) ?? "Sync",
    currency: readString(prop(body, "currency")) ?? "usd",
    unitAmount: typeof unitAmount === "number" ? unitAmount : null,
    interval: readString(prop(prop(body, "recurring"), "interval")),
  };
}

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
    `metadata['userId']:'${input.userId}' AND ` +
      `metadata['orgId']:'${input.organizationId}'`,
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
  return readString(prop(created, "id"));
}

/**
 * Resolves an org's pending (incomplete) checkout: resumed when it still
 * belongs to THIS buyer and the CURRENT price — a pending attempt by a since-
 * removed admin would otherwise be paid by someone else and then fail its
 * entitlement grant, and a pre-price-change attempt would charge the old
 * amount. A MISMATCHED pending attempt is a conflict, never cancelled: its
 * client secret may be mid-payment in another admin's browser, and Stripe
 * cancelling a subscription that just became paid would not refund it. The
 * conflict self-resolves when the attempt is paid (live) or expires
 * (terminal, at which point the search skips it and the create key rotates).
 */
async function resumePendingSubscription(input: {
  subscriptionId: string;
  userId: string;
  syncPriceId: string;
  fetchImpl: typeof fetch;
  secretKey: string;
}): Promise<
  | { kind: "resumed"; intent: StripeCheckoutIntent }
  | { kind: "conflict" }
  | { kind: "expired" }
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
  if (fetchedStatus !== "incomplete") {
    return fetchedStatus && LIVE_SUBSCRIPTION_STATUSES.has(fetchedStatus)
      ? { kind: "conflict" }
      : { kind: "expired" };
  }
  const pendingUserId = readString(prop(prop(pending, "metadata"), "userId"));
  const items = prop(prop(pending, "items"), "data");
  const pendingPriceId = Array.isArray(items)
    ? readString(prop(prop(items[0], "price"), "id"))
    : null;
  if (pendingUserId === input.userId && pendingPriceId === input.syncPriceId) {
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
): Promise<{
  candidate: { subscriptionId: string; status: string } | null;
  /**
   * Newest terminal (expired/canceled) attempt, used to rotate the create
   * idempotency key: without it, a create within Stripe's key-retention
   * window but after the previous attempt expired would replay the DEAD
   * subscription and its unusable client secret.
   */
  terminalAttemptId: string | null;
}> {
  const query = encodeURIComponent(`metadata['orgId']:'${organizationId}'`);
  const found = await stripeRequest({
    ...request,
    method: "GET",
    path: `/v1/subscriptions/search?query=${query}&limit=20`,
    operation: "subscription search",
  });
  const items = prop(found, "data");
  let terminalAttemptId: string | null = null;
  if (!Array.isArray(items)) {
    return { candidate: null, terminalAttemptId };
  }
  for (const item of items) {
    const status = readString(prop(item, "status"));
    const subscriptionId = readString(prop(item, "id"));
    if (!status || !subscriptionId) {
      continue;
    }
    if (LIVE_SUBSCRIPTION_STATUSES.has(status) || status === "incomplete") {
      return { candidate: { subscriptionId, status }, terminalAttemptId };
    }
    terminalAttemptId = terminalAttemptId ?? subscriptionId;
  }
  return { candidate: null, terminalAttemptId };
}

/**
 * Creates the sync subscription in `default_incomplete` mode and returns the
 * first invoice's PaymentIntent client secret for the Payment Element to
 * confirm. The subscription carries `userId`/`orgId` metadata so the Stripe
 * webhook can associate the paid subscription with the right RevenueCat
 * customer and organization (see revenueCatStripeAssociation.ts).
 */
export async function createSyncSubscription(
  input: { customerId: string; userId: string; organizationId: string },
  deps: StripeApiDeps = {},
): Promise<StripeCheckoutOutcome | null> {
  const { fetchImpl, secretKey, syncPriceId } = resolveDeps(deps);
  if (!secretKey || !syncPriceId) {
    return null;
  }

  const { candidate, terminalAttemptId } = await findOrgSubscription(
    input.organizationId,
    { fetchImpl, secretKey },
  );
  if (candidate && candidate.status !== "incomplete") {
    return { kind: "conflict" };
  }
  let rotationMarker = terminalAttemptId;
  if (candidate) {
    const resumed = await resumePendingSubscription({
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
    // The candidate turned out terminal on the authoritative read: proceed to
    // a fresh create, rotating the key off the dead attempt.
    rotationMarker = candidate.subscriptionId;
  }

  const form = new URLSearchParams();
  form.set("customer", input.customerId);
  form.set("items[0][price]", syncPriceId);
  form.set("payment_behavior", "default_incomplete");
  form.set("payment_settings[save_default_payment_method]", "on_subscription");
  form.set("metadata[userId]", input.userId);
  form.set("metadata[orgId]", input.organizationId);
  form.append("expand[]", "latest_invoice.payment_intent");
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: "/v1/subscriptions",
    operation: "subscription create",
    form,
    // ORG-scoped (no user in the key): a retried or double-submitted
    // checkout returns the original subscription, and two admins racing to
    // buy for the same org produce different request bodies under the same
    // key — which Stripe rejects — so the org can never gain two parallel
    // subscriptions. The terminal-attempt suffix rotates the key once a
    // previous attempt expired, so a fresh checkout never replays a dead
    // subscription that Stripe's key retention still remembers.
    idempotencyKey:
      `sync-sub:${input.organizationId}:${syncPriceId}` +
      `:${rotationMarker ?? "initial"}`,
  });
  const intent = parseCheckoutIntent(body);
  return intent ? { kind: "ready", intent } : null;
}

/** Reads a subscription's metadata (`userId`/`orgId`), status, and customer. */
export async function getSubscriptionBinding(
  subscriptionId: string,
  deps: StripeApiDeps = {},
): Promise<{
  userId: string | null;
  organizationId: string | null;
  status: string | null;
  customerId: string | null;
} | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "GET",
    path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    operation: "subscription lookup",
  });
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const metadata = prop(body, "metadata");
  const customer = prop(body, "customer");
  return {
    userId: readString(prop(metadata, "userId")),
    organizationId: readString(prop(metadata, "orgId")),
    status: readString(prop(body, "status")),
    customerId: readString(customer) ?? readString(prop(customer, "id")),
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
  return readString(prop(body, "url"));
}
