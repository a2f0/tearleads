/**
 * Minimal outbound RevenueCat REST API v2 client. The only thing the server
 * fetches from RevenueCat today is a customer's subscription-management URL, so
 * the org billing panel can offer any admin a manage/cancel link resolved from
 * the org's stored customer id (rather than the buyer's device-local SDK state).
 */

/** Environment variable holding the RevenueCat REST API v2 secret key (`sk_...`). */
const REVENUECAT_V2_SECRET_ENV_KEY = "REVENUECAT_V2_SECRET_KEY";
/** Environment variable holding the RevenueCat project id (`proj...`). */
const REVENUECAT_PROJECT_ID_ENV_KEY = "REVENUECAT_PROJECT_ID";

const REVENUECAT_API_V2_BASE = "https://api.revenuecat.com/v2";

interface RevenueCatApiDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

interface ResolvedSubscription {
  readonly givesAccess: boolean;
  readonly managementUrl: string | null;
}

/**
 * Reads the two fields this client needs off one RevenueCat v2 subscription
 * object, narrowing from `unknown` without a type assertion (the repo forbids
 * `as` in production sources).
 */
function readSubscription(item: unknown): ResolvedSubscription {
  if (typeof item !== "object" || item === null) {
    return { givesAccess: false, managementUrl: null };
  }
  const rawUrl = "management_url" in item ? item.management_url : null;
  const managementUrl =
    typeof rawUrl === "string" && rawUrl.length > 0 ? rawUrl : null;
  const givesAccess = "gives_access" in item && item.gives_access === true;
  return { givesAccess, managementUrl };
}

/**
 * Picks the management URL of the subscription that currently grants access.
 * A customer can carry several subscriptions (expired ones included); the one
 * with `gives_access` is the live subscription whose manage page we want. Falls
 * back to any subscription that exposes a URL so a just-lapsed subscriber can
 * still reach the provider to fix billing.
 */
function pickManagementUrl(items: readonly unknown[]): string | null {
  const subscriptions = items.map(readSubscription);
  const accessGiving = subscriptions.filter(
    (subscription) => subscription.givesAccess,
  );
  const candidates = accessGiving.length > 0 ? accessGiving : subscriptions;
  for (const subscription of candidates) {
    if (subscription.managementUrl) {
      return subscription.managementUrl;
    }
  }
  return null;
}

/**
 * Fetches the subscription-management URL for a RevenueCat customer, identified
 * by its App User ID (the org's stored `provider_customer_id`). Reads its
 * credentials from the environment and **never throws**: it returns null when
 * the integration is unconfigured, the customer or an access-giving subscription
 * is not found, or the request fails — so an unavailable manage link degrades to
 * a hidden button instead of erroring the billing panel.
 */
export async function fetchRevenueCatManagementUrl(
  appUserId: string,
  deps: RevenueCatApiDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const secretKey = env[REVENUECAT_V2_SECRET_ENV_KEY]?.trim();
  const projectId = env[REVENUECAT_PROJECT_ID_ENV_KEY]?.trim();
  if (!secretKey || !projectId) {
    return null;
  }

  const endpoint =
    `${REVENUECAT_API_V2_BASE}/projects/${encodeURIComponent(projectId)}` +
    `/customers/${encodeURIComponent(appUserId)}/subscriptions`;
  try {
    const response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      // 404 = no such customer (nothing to manage). Any other non-2xx is an
      // unexpected provider/auth error worth surfacing in logs; either way the
      // manage link is simply unavailable for this request.
      if (response.status !== 404) {
        console.error(
          `RevenueCat management URL lookup failed with status ${response.status}`,
        );
      }
      return null;
    }
    const body: unknown = await response.json();
    const items =
      typeof body === "object" &&
      body !== null &&
      "items" in body &&
      Array.isArray(body.items)
        ? body.items
        : [];
    return pickManagementUrl(items);
  } catch (error) {
    console.error("RevenueCat management URL lookup errored:", error);
    return null;
  }
}
