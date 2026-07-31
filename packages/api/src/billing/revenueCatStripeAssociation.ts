/**
 * Associates a paid Stripe subscription (direct web checkout, issue #1654)
 * with RevenueCat, which mirrors the entitlement lifecycle: RevenueCat ingests
 * renewals/cancellations from the connected Stripe account and emits the same
 * webhook events the rest of org sync billing already consumes. Stripe remains
 * authoritative for the web subscription's fixed tier and billing period.
 *
 * Three calls, in this order:
 *
 * 1. Create the customer (v2). Idempotent in effect: an existing customer
 *    answers 409, which is success for our purposes.
 * 2. Set the buyer's `orgId` attribute (v2). Unlike the v1 attributes
 *    endpoint this does NOT upsert the customer — it 404s when the customer
 *    is absent, which is why step 1 precedes it.
 * 3. Post the receipt (v1): `fetch_token` is the Stripe subscription id.
 *    RevenueCat has no v2 equivalent, and it authenticates with the project's
 *    Stripe app PUBLIC key rather than a secret key.
 *
 * The attribute is deliberately belt-and-braces: it is customer-level and
 * mutable, so a buyer purchasing for several organizations overwrites it. The
 * authoritative binding for Stripe-store events is the Stripe subscription's
 * own immutable metadata (see `resolveStripeStoreOrganizationId`); this
 * attribute only serves deployments where that lookup is unconfigured.
 *
 * Every call is safe to repeat, so a redelivered Stripe webhook can re-run
 * the association.
 */

import {
  REVENUECAT_API_ORIGIN,
  readRevenueCatV2Credentials,
} from "./revenueCatConfig";

/**
 * The RevenueCat project's Stripe app PUBLIC API key (`strp_…`); the receipts
 * endpoint authenticates Stripe receipts with it.
 */
const REVENUECAT_STRIPE_PUBLIC_API_KEY_ENV = "REVENUECAT_STRIPE_PUBLIC_API_KEY";

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
    readRevenueCatV2Credentials(env) !== null &&
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
  /** Statuses to treat as success besides 2xx (e.g. 409 already-exists). */
  tolerateStatuses?: readonly number[];
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
  if (response.ok || input.tolerateStatuses?.includes(response.status)) {
    return;
  }
  throw new RevenueCatAssociationError(input.operation, response.status);
}

/**
 * Runs the association. Throws when unconfigured or when any call fails, so
 * the Stripe webhook responds non-2xx and Stripe redelivers.
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
  const credentials = readRevenueCatV2Credentials(env);
  const stripePublicKey = env[REVENUECAT_STRIPE_PUBLIC_API_KEY_ENV]?.trim();
  if (!credentials || !stripePublicKey) {
    throw new RevenueCatAssociationError("association (unconfigured)", 0);
  }
  const { secretKey, projectId } = credentials;
  const customerPath =
    `/v2/projects/${encodeURIComponent(projectId)}` +
    `/customers/${encodeURIComponent(input.appUserId)}`;

  // The v2 attributes endpoint 404s for an unknown customer (unlike v1, which
  // upserts), so ensure the customer exists first. A customer created by an
  // earlier delivery — or by the buyer's own app session — answers 409, which
  // is the desired end state, not a failure.
  await postJson({
    fetchImpl,
    path: `/v2/projects/${encodeURIComponent(projectId)}/customers`,
    apiKey: secretKey,
    operation: "customer create",
    body: { id: input.appUserId },
    tolerateStatuses: [409],
  });

  await postJson({
    fetchImpl,
    path: `${customerPath}/attributes`,
    apiKey: secretKey,
    operation: "attribute update",
    // v2 takes an ARRAY of {name, value} — not v1's keyed object with
    // `updated_at_ms`.
    body: {
      attributes: [
        {
          name: ORGANIZATION_SUBSCRIBER_ATTRIBUTE,
          value: input.organizationId,
        },
      ],
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
