/**
 * Shared HTTP plumbing for the outbound Stripe REST client (issue #1654):
 * configuration reading, the request helper (auth, pinned API version,
 * timeouts, idempotency keys), and the untyped-JSON access helpers. The
 * domain calls live in stripeApi.ts.
 */

import {
  SYNC_BILLING_TIERS,
  type SyncBillingTier,
  type SyncBillingTierId,
} from "@symcrypt/validators/billing";

/** Environment variable holding the Stripe secret key (`sk_test_…`/`sk_live_…`). */
const STRIPE_SECRET_KEY_ENV = "STRIPE_SECRET_KEY";

const STRIPE_PRICE_ENV_BY_TIER = {
  solo: "STRIPE_SYNC_SOLO_PRICE_ID",
  team_5: "STRIPE_SYNC_TEAM_5_PRICE_ID",
  team_10: "STRIPE_SYNC_TEAM_10_PRICE_ID",
} as const satisfies Record<SyncBillingTierId, string>;

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

function readEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function resolveDeps(deps: StripeApiDeps): {
  fetchImpl: typeof fetch;
  secretKey: string | null;
  syncPriceIds: Readonly<Record<SyncBillingTierId, string | null>>;
} {
  const env = deps.env ?? process.env;
  return {
    fetchImpl: deps.fetchImpl ?? fetch,
    secretKey: readEnv(env, STRIPE_SECRET_KEY_ENV),
    syncPriceIds: {
      solo: readEnv(env, STRIPE_PRICE_ENV_BY_TIER.solo),
      team_5: readEnv(env, STRIPE_PRICE_ENV_BY_TIER.team_5),
      team_10: readEnv(env, STRIPE_PRICE_ENV_BY_TIER.team_10),
    },
  };
}

export function getStripePriceIdForTier(
  tierId: SyncBillingTierId,
  deps: StripeApiDeps = {},
): string | null {
  return resolveDeps(deps).syncPriceIds[tierId];
}

export function getSyncBillingTierForStripePrice(
  priceId: string | null | undefined,
  deps: StripeApiDeps = {},
): SyncBillingTier | null {
  if (!priceId) {
    return null;
  }
  const { syncPriceIds } = resolveDeps(deps);
  return (
    SYNC_BILLING_TIERS.find((tier) => syncPriceIds[tier.id] === priceId) ?? null
  );
}

/** True when the secret and all three fixed-tier prices are configured. */
export function isStripeCheckoutConfigured(deps: StripeApiDeps = {}): boolean {
  const { secretKey, syncPriceIds } = resolveDeps(deps);
  const configuredPriceIds = Object.values(syncPriceIds).filter(
    (priceId): priceId is string => priceId !== null,
  );
  return (
    secretKey !== null &&
    configuredPriceIds.length === SYNC_BILLING_TIERS.length &&
    new Set(configuredPriceIds).size === SYNC_BILLING_TIERS.length
  );
}

export async function stripeRequest(input: {
  fetchImpl: typeof fetch;
  secretKey: string;
  method: "GET" | "POST";
  path: string;
  operation: string;
  form?: URLSearchParams;
  idempotencyKey?: string;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await performStripeFetch(input);
  } catch (error) {
    if (error instanceof StripeApiError) {
      throw error;
    }
    // Timeouts and network failures are provider failures too: callers map
    // StripeApiError to 502 uniformly instead of a generic 500. Status 0
    // marks "no HTTP response".
    console.error(`Stripe ${input.operation} transport failure:`, error);
    throw new StripeApiError(`${input.operation} (transport)`, 0);
  }
  if (!response.ok) {
    throw new StripeApiError(input.operation, response.status);
  }
  return response.json();
}

async function performStripeFetch(input: {
  fetchImpl: typeof fetch;
  secretKey: string;
  method: "GET" | "POST";
  path: string;
  operation: string;
  form?: URLSearchParams;
  idempotencyKey?: string;
}): Promise<Response> {
  return input.fetchImpl(`${STRIPE_API_ORIGIN}${input.path}`, {
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
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function readPositiveInteger(value: unknown): number | null {
  const integer = readNonnegativeInteger(value);
  return integer !== null && integer > 0 ? integer : null;
}

export function readUnixTimestamp(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Reads one property from an unknown value when it is a plain object. The key
 * is a parameter, which keeps both tsc's no-index-signature-dot-access rule
 * and biome's prefer-dot-access rule satisfied (neither fires on a variable
 * key).
 */
export function prop(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  // Reflect.get reads without copying the object (these parses chain many
  // reads) and without the type assertion the repo forbids.
  return Reflect.get(value, key);
}

/**
 * Escapes a value for interpolation inside a single-quoted Stripe search
 * clause. The interpolated ids are server-controlled UUIDs today; the escape
 * keeps a future caller from corrupting the query's meaning with a quote.
 */
export function escapeSearchValue(value: string): string {
  return value.replace(/[\\']/g, "\\$&");
}
