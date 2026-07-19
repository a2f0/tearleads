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
}): Promise<unknown> {
  const response = await input.fetchImpl(`${STRIPE_API_ORIGIN}${input.path}`, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
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
 * Finds the Stripe customer previously created for this user (matched on the
 * `userId` metadata this module writes), or creates one. Search is eventually
 * consistent, so a rapid retry can create a duplicate customer — harmless
 * here, because the subscription (not the customer) carries the org binding.
 */
export async function findOrCreateCustomer(
  userId: string,
  deps: StripeApiDeps = {},
): Promise<string | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const query = encodeURIComponent(`metadata['userId']:'${userId}'`);
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
  form.set("metadata[userId]", userId);
  const created = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: "/v1/customers",
    operation: "customer create",
    form,
  });
  return readString(prop(created, "id"));
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
): Promise<StripeCheckoutIntent | null> {
  const { fetchImpl, secretKey, syncPriceId } = resolveDeps(deps);
  if (!secretKey || !syncPriceId) {
    return null;
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
  });
  const subscriptionId = readString(prop(body, "id"));
  const clientSecret = readString(
    prop(prop(prop(body, "latest_invoice"), "payment_intent"), "client_secret"),
  );
  if (!subscriptionId || !clientSecret) {
    return null;
  }
  return { subscriptionId, clientSecret };
}

/** Reads a subscription's metadata (`userId`/`orgId`) and status. */
export async function getSubscriptionBinding(
  subscriptionId: string,
  deps: StripeApiDeps = {},
): Promise<{
  userId: string | null;
  organizationId: string | null;
  status: string | null;
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
  return {
    userId: readString(prop(metadata, "userId")),
    organizationId: readString(prop(metadata, "orgId")),
    status: readString(prop(body, "status")),
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
