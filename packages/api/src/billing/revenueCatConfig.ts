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

/** RevenueCat serves relative `next_page` paths (e.g. `/v2/…`) off this origin. */
export const REVENUECAT_API_ORIGIN = "https://api.revenuecat.com";

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
