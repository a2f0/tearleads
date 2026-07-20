/**
 * Shared HTTP plumbing for the outbound Stripe REST client (issue #1654):
 * configuration reading, the request helper (auth, pinned API version,
 * timeouts, idempotency keys), and the untyped-JSON access helpers. The
 * domain calls live in stripeApi.ts.
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

function readEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function resolveDeps(deps: StripeApiDeps): {
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
