/**
 * Shared RevenueCat REST configuration. The management-URL lookup
 * (revenueCatApi.ts) and the Stripe association (revenueCatStripeAssociation.ts)
 * deliberately consume the SAME v2 credentials — a contract the billing docs
 * state explicitly — so the env key names and API origin live here rather than
 * being duplicated per module, where a rename could silently drift apart.
 */

/** RevenueCat REST API v2 secret key (`sk_…`). */
const REVENUECAT_V2_SECRET_KEY_ENV = "REVENUECAT_V2_SECRET_KEY";
/** RevenueCat project id (`proj…`); v2 paths are project-scoped. */
const REVENUECAT_PROJECT_ID_ENV = "REVENUECAT_PROJECT_ID";

/**
 * Opts a tier into applying RevenueCat's SANDBOX-environment webhook events.
 * Absent or anything other than `true` keeps the tier production-only.
 */
const REVENUECAT_ALLOW_SANDBOX_EVENTS_ENV = "REVENUECAT_ALLOW_SANDBOX_EVENTS";

/** RevenueCat serves relative `next_page` paths (e.g. `/v2/…`) off this origin. */
export const REVENUECAT_API_ORIGIN = "https://api.revenuecat.com";

/**
 * Whether this tier grants sync from RevenueCat events marked `SANDBOX`.
 *
 * A StoreKit-sandbox, TestFlight, or Play internal-testing purchase costs the
 * tester nothing but produces a webhook event otherwise identical to a paid
 * one — same type, same entitlement, same subscriber attributes. A tier that
 * applies them hands out real sync and provisions real seats for free, so this
 * fails closed: only a tier that explicitly sets the flag (staging, where
 * native purchases are exercised) accepts them.
 */
export function allowsRevenueCatSandboxEvents(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[REVENUECAT_ALLOW_SANDBOX_EVENTS_ENV]?.trim() === "true";
}

/**
 * Reads the v2 credential pair, or null when either half is absent — callers
 * treat an incomplete pair as "integration not configured" rather than
 * attempting a request that would certainly fail.
 */
export function readRevenueCatV2Credentials(
  env: NodeJS.ProcessEnv = process.env,
): { secretKey: string; projectId: string } | null {
  const secretKey = env[REVENUECAT_V2_SECRET_KEY_ENV]?.trim();
  const projectId = env[REVENUECAT_PROJECT_ID_ENV]?.trim();
  return secretKey && projectId ? { secretKey, projectId } : null;
}
