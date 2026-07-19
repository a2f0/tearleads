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

/** RevenueCat serves relative `next_page` paths (e.g. `/v2/…`) off this origin. */
const REVENUECAT_API_ORIGIN = "https://api.revenuecat.com";
/** Fail soft rather than hang if RevenueCat stalls mid-request. */
const REQUEST_TIMEOUT_MS = 5000;
/** Bound pagination — a sync customer has one or two subscriptions, never many. */
const MAX_SUBSCRIPTION_PAGES = 10;

interface RevenueCatApiDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

/**
 * The org's stored provider identifiers, used to pick the subscription that
 * belongs to THIS organization when a customer (one buyer/app-user) holds more
 * than one — e.g. an admin who bought sync for several orgs under one account.
 */
interface OrganizationSubscriptionRef {
  readonly subscriptionId: string | null;
  readonly transactionId: string | null;
}

interface ResolvedSubscription {
  readonly givesAccess: boolean;
  readonly managementUrl: string | null;
  readonly storeIdentifier: string | null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Reads the fields this client needs off one RevenueCat v2 subscription object,
 * narrowing from `unknown` with the `in` operator — no type assertion (the repo
 * forbids `as` in production sources).
 */
function readSubscription(item: unknown): ResolvedSubscription {
  if (typeof item !== "object" || item === null) {
    return { givesAccess: false, managementUrl: null, storeIdentifier: null };
  }
  return {
    givesAccess: "gives_access" in item && item.gives_access === true,
    managementUrl: readNonEmptyString(
      "management_url" in item ? item.management_url : null,
    ),
    storeIdentifier: readNonEmptyString(
      "store_subscription_identifier" in item
        ? item.store_subscription_identifier
        : null,
    ),
  };
}

/** Extracts the subscriptions and the next-page path from one list response. */
function parseSubscriptionPage(body: unknown): {
  subscriptions: ResolvedSubscription[];
  nextPage: string;
} {
  if (typeof body !== "object" || body === null) {
    return { subscriptions: [], nextPage: "" };
  }
  const subscriptions =
    "items" in body && Array.isArray(body.items)
      ? body.items.map(readSubscription)
      : [];
  const nextPage =
    "next_page" in body && typeof body.next_page === "string"
      ? body.next_page
      : "";
  return { subscriptions, nextPage };
}

/**
 * Chooses the management URL for the organization's subscription among a
 * customer's subscriptions. When the org has a stored subscription/transaction
 * id, it matches that id across ALL of the customer's subscriptions — active or
 * lapsed — and returns only the matched one (a lapsed subscription still has a
 * manage page to fix billing), never another org's. Only when the org has NO
 * stored reference does it fall back to the sole access-giving subscription,
 * returning null when several are ambiguous — so an admin is never sent to a
 * different organization's manage page.
 */
function pickManagementUrl(
  subscriptions: readonly ResolvedSubscription[],
  ref: OrganizationSubscriptionRef,
): string | null {
  const storeIds = [ref.subscriptionId, ref.transactionId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (storeIds.length > 0) {
    const matched = subscriptions.find(
      (subscription) =>
        subscription.storeIdentifier !== null &&
        storeIds.includes(subscription.storeIdentifier),
    );
    // The stored id identifies this org's subscription exactly. Return its URL
    // (or null if it has none / is absent) — never fall back to a subscription
    // that could belong to a different organization.
    return matched ? matched.managementUrl : null;
  }

  // No stored reference (e.g. a legacy billing row written before these ids
  // were persisted): fall back to the sole access-giving subscription; with
  // several and nothing to disambiguate, do not guess.
  const accessGiving = subscriptions.filter(
    (subscription) => subscription.givesAccess,
  );
  return accessGiving.length === 1
    ? (accessGiving[0]?.managementUrl ?? null)
    : null;
}

/** Fetches every subscription page for a customer (bounded, per-request timeout). */
async function fetchCustomerSubscriptions(
  appUserId: string,
  projectId: string,
  secretKey: string,
  fetchImpl: typeof fetch,
): Promise<ResolvedSubscription[]> {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json",
  };
  let path =
    `/v2/projects/${encodeURIComponent(projectId)}` +
    `/customers/${encodeURIComponent(appUserId)}/subscriptions`;
  const subscriptions: ResolvedSubscription[] = [];

  for (let page = 0; page < MAX_SUBSCRIPTION_PAGES && path; page++) {
    const response = await fetchImpl(`${REVENUECAT_API_ORIGIN}${path}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 404 = no such customer (nothing to manage). Any other non-2xx is an
      // unexpected provider/auth error worth logging; either way, use only the
      // pages already collected.
      if (response.status !== 404) {
        console.error(
          `RevenueCat management URL lookup failed with status ${response.status}`,
        );
      }
      break;
    }
    const parsed = parseSubscriptionPage(await response.json());
    subscriptions.push(...parsed.subscriptions);
    path = parsed.nextPage;
  }
  return subscriptions;
}

/**
 * Fetches the subscription-management URL for a RevenueCat customer, identified
 * by its App User ID (the org's stored `provider_customer_id`). Reads its
 * credentials from the environment and **never throws**: it returns null when
 * the integration is unconfigured, the customer or a matching subscription is
 * not found, or a request fails/stalls — so an unavailable manage link degrades
 * to a hidden button instead of erroring the billing panel.
 */
export async function fetchRevenueCatManagementUrl(
  appUserId: string,
  ref: OrganizationSubscriptionRef,
  deps: RevenueCatApiDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const secretKey = env[REVENUECAT_V2_SECRET_ENV_KEY]?.trim();
  const projectId = env[REVENUECAT_PROJECT_ID_ENV_KEY]?.trim();
  if (!secretKey || !projectId) {
    return null;
  }

  try {
    const subscriptions = await fetchCustomerSubscriptions(
      appUserId,
      projectId,
      secretKey,
      fetchImpl,
    );
    return pickManagementUrl(subscriptions, ref);
  } catch (error) {
    console.error("RevenueCat management URL lookup errored:", error);
    return null;
  }
}
