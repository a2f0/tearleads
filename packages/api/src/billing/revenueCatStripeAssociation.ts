/**
 * Associates a paid Stripe subscription (direct web checkout, issue #1654)
 * with RevenueCat, which then owns the subscription lifecycle: RevenueCat
 * ingests renewals/cancellations from the connected Stripe account and emits
 * the same webhook events the rest of org sync billing already consumes.
 *
 * Two ordered calls, both against RevenueCat's v1 API:
 *
 * 1. Set the buyer's `orgId` subscriber attribute. RevenueCat's webhook
 *    events for Stripe-store purchases carry subscriber attributes (not
 *    transaction metadata), and our webhook resolves the organization from
 *    that attribute — so it MUST be in place before the receipt creates the
 *    INITIAL_PURCHASE event.
 * 2. Post the receipt: `fetch_token` is the Stripe subscription id.
 *
 * Both calls are idempotent, so a retried Stripe webhook delivery can safely
 * run the association again.
 */

/** RevenueCat v1 secret API key (`sk_…`), used for the attributes call. */
const REVENUECAT_SECRET_API_KEY_ENV = "REVENUECAT_SECRET_API_KEY";
/**
 * The RevenueCat project's Stripe app PUBLIC API key (`strp_…`); the receipts
 * endpoint authenticates Stripe receipts with it.
 */
const REVENUECAT_STRIPE_PUBLIC_API_KEY_ENV = "REVENUECAT_STRIPE_PUBLIC_API_KEY";

const REVENUECAT_API_ORIGIN = "https://api.revenuecat.com";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Subscriber attribute key binding a purchase to an organization — must match
 * `ORGANIZATION_SUBSCRIBER_ATTRIBUTE` in revenuecatWebhook.ts (the reader).
 */
const ORGANIZATION_SUBSCRIBER_ATTRIBUTE = "orgId";

export interface RevenueCatAssociationDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

/** A RevenueCat association call failed and the webhook should be retried. */
export class RevenueCatAssociationError extends Error {
  constructor(operation: string, status: number) {
    super(`RevenueCat ${operation} failed with status ${status}`);
    this.name = "RevenueCatAssociationError";
  }
}

export function isRevenueCatAssociationConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    Boolean(env[REVENUECAT_SECRET_API_KEY_ENV]?.trim()) &&
    Boolean(env[REVENUECAT_STRIPE_PUBLIC_API_KEY_ENV]?.trim())
  );
}

async function postJson(input: {
  fetchImpl: typeof fetch;
  path: string;
  apiKey: string;
  operation: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}): Promise<void> {
  const response = await input.fetchImpl(
    `${REVENUECAT_API_ORIGIN}${input.path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new RevenueCatAssociationError(input.operation, response.status);
  }
}

/**
 * Runs the two-step association. Throws when unconfigured or when either call
 * fails, so the Stripe webhook responds non-2xx and Stripe redelivers.
 */
export async function associateStripeSubscription(
  input: {
    appUserId: string;
    organizationId: string;
    subscriptionId: string;
  },
  deps: RevenueCatAssociationDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const secretKey = env[REVENUECAT_SECRET_API_KEY_ENV]?.trim();
  const stripePublicKey = env[REVENUECAT_STRIPE_PUBLIC_API_KEY_ENV]?.trim();
  if (!secretKey || !stripePublicKey) {
    throw new RevenueCatAssociationError("association (unconfigured)", 0);
  }

  // Attribute FIRST: the receipt below creates the INITIAL_PURCHASE event,
  // whose org resolution reads the subscriber attributes at event time.
  await postJson({
    fetchImpl,
    path: `/v1/subscribers/${encodeURIComponent(input.appUserId)}/attributes`,
    apiKey: secretKey,
    operation: "attribute update",
    body: {
      attributes: {
        [ORGANIZATION_SUBSCRIBER_ATTRIBUTE]: {
          value: input.organizationId,
          // Required by the v1 attributes endpoint; RevenueCat also uses it
          // for last-write-wins conflict resolution between devices.
          updated_at_ms: Date.now(),
        },
      },
    },
  });

  await postJson({
    fetchImpl,
    path: "/v1/receipts",
    apiKey: stripePublicKey,
    operation: "receipt post",
    headers: { "X-Platform": "stripe" },
    body: {
      app_user_id: input.appUserId,
      fetch_token: input.subscriptionId,
    },
  });
}
