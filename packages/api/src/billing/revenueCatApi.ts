/** Minimal outbound RevenueCat REST API v2 client. */

import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import {
  allowsRevenueCatSandboxEvents,
  REVENUECAT_API_ORIGIN,
  readRevenueCatV2Credentials,
} from "./revenueCatConfig";

/** Fail soft rather than hang if RevenueCat stalls mid-request. */
const REQUEST_TIMEOUT_MS = 5000;
/** Bound pagination — a sync customer has one or two subscriptions, never many. */
const MAX_SUBSCRIPTION_PAGES = 10;

export interface RevenueCatApiDeps {
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
  readonly currentPeriodEndsAt: Date | null;
  readonly currentPeriodStartsAt: Date | null;
  readonly environment: string | null;
  readonly givesAccess: boolean;
  readonly managementUrl: string | null;
  readonly productResourceId: string | null;
  readonly store: string | null;
  readonly storeIdentifier: string | null;
}

export interface ActiveNativeSubscription {
  readonly currentPeriodEndsAt: Date | null;
  readonly currentPeriodStartsAt: Date | null;
  readonly productId: string;
  readonly store: NativeSubscriptionStore;
  readonly subscriptionId: string;
}

type ActiveNativeSubscriptionResult =
  | { readonly kind: "found"; readonly subscription: ActiveNativeSubscription }
  | { readonly kind: "customer_not_found" }
  | { readonly kind: "not_found" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unavailable" };

interface CustomerSubscriptionsResult {
  readonly complete: boolean;
  readonly customerMissing: boolean;
  readonly subscriptions: ResolvedSubscription[];
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : new Date(milliseconds);
}

/**
 * Reads the fields this client needs off one RevenueCat v2 subscription object,
 * narrowing from `unknown` with the `in` operator — no type assertion (the repo
 * forbids `as` in production sources).
 */
function readSubscription(item: unknown): ResolvedSubscription {
  if (typeof item !== "object" || item === null) {
    return {
      currentPeriodEndsAt: null,
      currentPeriodStartsAt: null,
      environment: null,
      givesAccess: false,
      managementUrl: null,
      productResourceId: null,
      store: null,
      storeIdentifier: null,
    };
  }
  return {
    currentPeriodEndsAt: readDate(
      "current_period_ends_at" in item ? item.current_period_ends_at : null,
    ),
    currentPeriodStartsAt: readDate(
      "current_period_starts_at" in item ? item.current_period_starts_at : null,
    ),
    environment: readNonEmptyString(
      "environment" in item ? item.environment : null,
    ),
    givesAccess: "gives_access" in item && item.gives_access === true,
    managementUrl: readNonEmptyString(
      "management_url" in item ? item.management_url : null,
    ),
    productResourceId: readNonEmptyString(
      "product_id" in item ? item.product_id : null,
    ),
    store: readNonEmptyString("store" in item ? item.store : null),
    storeIdentifier: readNonEmptyString(
      "store_subscription_identifier" in item
        ? item.store_subscription_identifier
        : null,
    ),
  };
}

function subscriptionMatchesStore(
  subscription: ResolvedSubscription,
  store: NativeSubscriptionStore,
): boolean {
  return subscription.store?.toLowerCase() === store;
}

function isActiveSubscription(subscription: ResolvedSubscription): boolean {
  return subscription.givesAccess;
}

async function fetchProductStoreIdentifier(input: {
  readonly fetchImpl: typeof fetch;
  readonly productResourceId: string;
  readonly projectId: string;
  readonly secretKey: string;
}): Promise<string | null> {
  const response = await input.fetchImpl(
    `${REVENUECAT_API_ORIGIN}/v2/projects/${encodeURIComponent(input.projectId)}` +
      `/products/${encodeURIComponent(input.productResourceId)}`,
    {
      headers: {
        Authorization: `Bearer ${input.secretKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "store_identifier" in body
    ? readNonEmptyString(body.store_identifier)
    : null;
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
 * different organization's manage page. `complete` reports whether the whole
 * subscription list was retrieved; that fallback is skipped on a partial list,
 * which could otherwise hide a second subscription and make one look sole.
 */
function pickManagementUrl(
  subscriptions: readonly ResolvedSubscription[],
  ref: OrganizationSubscriptionRef,
  complete: boolean,
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

  // No stored subscription/transaction reference on the billing row: fall
  // back to the sole access-giving subscription; with
  // several and nothing to disambiguate, do not guess. Only a fully-retrieved
  // list is safe to reduce to a "sole" subscription — a partial list could omit
  // another org's subscription and make one look sole.
  if (!complete) {
    return null;
  }
  const accessGiving = subscriptions.filter(
    (subscription) => subscription.givesAccess,
  );
  return accessGiving.length === 1
    ? (accessGiving[0]?.managementUrl ?? null)
    : null;
}

/**
 * Fetches every subscription page for a customer (bounded, per-request timeout).
 * `complete` is true only when the ENTIRE list was read — false on a mid-request
 * failure or when the page cap was hit with pages remaining — so a caller does
 * not treat a partial list as the customer's full set of subscriptions.
 */
async function fetchCustomerSubscriptions(
  appUserId: string,
  projectId: string,
  secretKey: string,
  fetchImpl: typeof fetch,
): Promise<CustomerSubscriptionsResult> {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json",
  };
  let path =
    `/v2/projects/${encodeURIComponent(projectId)}` +
    `/customers/${encodeURIComponent(appUserId)}/subscriptions`;
  const subscriptions: ResolvedSubscription[] = [];

  for (let page = 0; page < MAX_SUBSCRIPTION_PAGES; page++) {
    const response = await fetchImpl(`${REVENUECAT_API_ORIGIN}${path}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // A FIRST-page 404 means the customer has no subscriptions: an empty but
      // COMPLETE result. Any other error — or a 404 after a page was already
      // collected (an expired cursor, a mid-pagination deletion) — leaves the
      // list incomplete, so the no-id fallback must not treat it as the full set.
      if (response.status !== 404) {
        console.error(
          `RevenueCat management URL lookup failed with status ${response.status}`,
        );
      }
      return {
        subscriptions,
        complete: response.status === 404 && page === 0,
        customerMissing: response.status === 404 && page === 0,
      };
    }
    const parsed = parseSubscriptionPage(await response.json());
    subscriptions.push(...parsed.subscriptions);
    if (!parsed.nextPage) {
      return { subscriptions, complete: true, customerMissing: false };
    }
    path = parsed.nextPage;
  }
  // Reached the page cap with pages still remaining: an incomplete list.
  return { subscriptions, complete: false, customerMissing: false };
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
  const credentials = readRevenueCatV2Credentials(env);
  if (!credentials) {
    return null;
  }
  const { secretKey, projectId } = credentials;

  try {
    const { subscriptions, complete } = await fetchCustomerSubscriptions(
      appUserId,
      projectId,
      secretKey,
      fetchImpl,
    );
    return pickManagementUrl(subscriptions, ref, complete);
  } catch (error) {
    console.error("RevenueCat management URL lookup errored:", error);
    return null;
  }
}

/**
 * Resolves the one active subscription owned by a RevenueCat App User ID on a
 * particular native store. Product and period data are read from RevenueCat;
 * callers never trust client-supplied billing identifiers or capacity.
 */
export async function fetchActiveRevenueCatNativeSubscription(
  appUserId: string,
  store: NativeSubscriptionStore,
  deps: RevenueCatApiDeps = {},
): Promise<ActiveNativeSubscriptionResult> {
  const env = deps.env ?? process.env;
  if (store === "test_store" && !allowsRevenueCatSandboxEvents(env)) {
    return { kind: "not_found" };
  }
  const credentials = readRevenueCatV2Credentials(env);
  if (!credentials) return { kind: "unavailable" };
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const result = await fetchCustomerSubscriptions(
      appUserId,
      credentials.projectId,
      credentials.secretKey,
      fetchImpl,
    );
    if (result.customerMissing) return { kind: "customer_not_found" };
    if (!result.complete) return { kind: "unavailable" };
    const allowSandbox = allowsRevenueCatSandboxEvents(env);
    const subscriptions = result.subscriptions.filter(
      (subscription) =>
        isActiveSubscription(subscription) &&
        subscriptionMatchesStore(subscription, store) &&
        (subscription.environment?.toLowerCase() !== "sandbox" || allowSandbox),
    );
    if (subscriptions.length === 0) return { kind: "not_found" };
    if (subscriptions.length > 1) return { kind: "ambiguous" };
    const subscription = subscriptions[0];
    if (!subscription?.productResourceId || !subscription.storeIdentifier) {
      return { kind: "unavailable" };
    }
    const productId = await fetchProductStoreIdentifier({
      fetchImpl,
      productResourceId: subscription.productResourceId,
      projectId: credentials.projectId,
      secretKey: credentials.secretKey,
    });
    if (!productId) return { kind: "unavailable" };
    return {
      kind: "found",
      subscription: {
        currentPeriodEndsAt: subscription.currentPeriodEndsAt,
        currentPeriodStartsAt: subscription.currentPeriodStartsAt,
        productId,
        store,
        subscriptionId: subscription.storeIdentifier,
      },
    };
  } catch (error) {
    console.error("RevenueCat active subscription lookup errored:", error);
    return { kind: "unavailable" };
  }
}
