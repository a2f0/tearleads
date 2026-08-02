import type {
  OrganizationBillingProvider,
  OrganizationBillingStatus,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { isUuidV4String } from "@tearleads/validators/util";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "./organizationBilling";
import type { StripeApiDeps } from "./stripeApi";
import { getSubscriptionBinding } from "./stripeSubscriptionBinding";

/**
 * Environment variable holding the exact value RevenueCat must send in the
 * webhook `Authorization` header. Configured per environment in `.secrets/*.env`
 * and mirrored in the RevenueCat dashboard. Absent → the webhook is disabled
 * (fails closed).
 */
const REVENUECAT_WEBHOOK_AUTH_ENV_KEY = "REVENUECAT_WEBHOOK_AUTH_HEADER";

const REVENUECAT_PROVIDER: OrganizationBillingProvider = "revenuecat";

/**
 * Subscriber attribute key whose value binds a RevenueCat purchase to the
 * organization being paid for. The client sets it when it starts a purchase on
 * behalf of an organization.
 */
const ORGANIZATION_SUBSCRIBER_ATTRIBUTE = "orgId";

/**
 * The `environment` value RevenueCat sends for a purchase made against a store
 * sandbox (StoreKit sandbox, TestFlight, Play internal testing).
 */
const SANDBOX_ENVIRONMENT = "SANDBOX";

/** RevenueCat's `store` value for a purchase processed by Stripe. */
const STRIPE_STORE = "STRIPE";
const PROMOTIONAL_STORE = "PROMOTIONAL";

/**
 * Ignore reason for an event dropped by the sandbox gate. Exported so callers
 * can recognize *this* ignore among the many ordinary ones (an unhandled type,
 * a cancellation without lapse) rather than re-deriving it from the event.
 */
export const SANDBOX_IGNORED_REASON =
  "Sandbox environment event ignored on a production-only tier";

/** Paid product id that does not map to one of Tearleads' fixed tiers. */
export const UNCONFIGURED_SYNC_BILLING_TIER_REASON =
  "Event product is not a configured sync billing tier";

/**
 * Whether the event is a store-sandbox purchase this server must not apply.
 *
 * Absent `environment` is treated as production: RevenueCat has not always sent
 * the field, and a redelivered old event must keep its original (paid) meaning
 * rather than being discarded.
 *
 * **Stripe-store events are deliberately exempt.** RevenueCat marks Stripe
 * *test-mode* transactions `SANDBOX` too, so gating on the field alone would
 * stop a tier that exercises direct Stripe checkout with test-mode keys from
 * applying its own web billing — the documented way to test fixed-tier
 * enrollment. What stands in for the guard is Stripe's own attribution: a
 * foreign-mode subscription cannot be resolved through the durable binding or
 * the exact `sub_…` lookup, both of which run against that tier's own Stripe
 * key and fail closed (`resolveImmutableStripeStoreOrganizationId`). The
 * mutable `orgId` subscriber attribute the native lane falls back on has no
 * equivalent protection, which is exactly why the guard exists there.
 */
function isGuardedSandboxEvent(event: RevenueCatWebhookEvent): boolean {
  if (event.store?.toUpperCase() === STRIPE_STORE) {
    return false;
  }
  return event.environment?.toUpperCase() === SANDBOX_ENVIRONMENT;
}

/**
 * Event types that assert the entitlement is currently granted. RevenueCat
 * keeps the entitlement (and the `expiration_at_ms` it reports) valid through
 * billing-issue grace periods, so any of these transitions the org to `active`.
 */
const GRANT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
]);

const BOUND_TIER_REUSE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "RENEWAL",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
]);

export const BOUND_REVENUECAT_TIER_REQUIRED_REASON =
  "Lifecycle grant requires the organization's bound RevenueCat tier";

/** PRODUCT_CHANGE announces a requested change; a later store event makes it effective. */
export const BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON =
  "Product change requires the organization's bound RevenueCat subscription";

/** Non-native plan changes are authoritative in their own billing provider. */
export const NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON =
  "Non-native product changes are managed by their billing provider";

/** Unknown store values cannot safely authorize native plan changes. */
export const UNKNOWN_REVENUECAT_PRODUCT_CHANGE_STORE_REASON =
  "Product change store is not a recognized native store";

/** Immediate Play changes omit a destination and are settled by INITIAL_PURCHASE. */
export const PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON =
  "Google Play product change has no deferred destination";

export function isRevenueCatGrantEventType(type: string): boolean {
  return GRANT_EVENT_TYPES.has(type);
}

/**
 * Event types that assert the entitlement was lost. `CANCELLATION` is
 * intentionally NOT here: it only turns off auto-renew, and the entitlement
 * stays valid until `EXPIRATION`.
 */
const REVOKE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "EXPIRATION",
  "SUBSCRIPTION_PAUSED",
]);

interface RevenueCatGrantFields {
  status: OrganizationBillingStatus;
  provider: OrganizationBillingProvider;
  providerCustomerId: string;
  providerSubscriptionId: string | null;
  providerProductId: string | null;
  providerTransactionId: string | null;
  entitlementId: string | null;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  trialEndsAt: null;
  disabledAt: null;
  purgeAfter: null;
  seatCount: number;
}

interface RevenueCatRevokeFields {
  status: OrganizationBillingStatus;
  disabledAt: Date;
  purgeAfter: Date;
}

interface RevenueCatScheduleFields {
  status: OrganizationBillingStatus;
}

/**
 * The billing effect a RevenueCat event has on an organization, computed purely
 * from the event. `grant`/`revoke` carry the exact `organization_billing`
 * columns to write; `ignore` records why the event was a no-op (unknown type,
 * cancellation-without-lapse, …).
 */
export type RevenueCatBillingTransition =
  | { kind: "grant"; fields: RevenueCatGrantFields }
  | { kind: "schedule"; fields: RevenueCatScheduleFields }
  | { kind: "revoke"; fields: RevenueCatRevokeFields }
  | { kind: "ignore"; reason: string };

/**
 * Reads the configured webhook authorization header value. Returns null when
 * unset so the route can fail closed rather than accept unauthenticated posts.
 */
export function readRevenueCatWebhookAuthToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const token = env[REVENUECAT_WEBHOOK_AUTH_ENV_KEY]?.trim();
  return token ? token : null;
}

/**
 * Resolves the organization a RevenueCat event is paying for.
 *
 * Preferred source is the event's transaction `metadata` (Web Billing): the
 * client stamps `orgId` onto each purchase there, and it is immutable per
 * transaction — a purchase that completes late is still attributed to the org
 * it was started for, even if the buyer began another org's purchase in the
 * meantime. The `orgId` *subscriber attribute* is customer-level and mutable
 * (each purchase overwrites it), so it is only the fallback for events that
 * carry no metadata — native store purchases.
 *
 * Returns null when neither source holds a valid organization id (which a
 * caller treats as an ignorable event rather than querying the database with a
 * malformed id).
 */
export function resolveOrganizationIdFromEvent(
  event: RevenueCatWebhookEvent,
): string | null {
  const metadataOrganizationId =
    resolveOrganizationIdFromTransactionMetadata(event);
  if (metadataOrganizationId) {
    return metadataOrganizationId;
  }
  const attributeValue =
    event.subscriber_attributes?.[ORGANIZATION_SUBSCRIBER_ATTRIBUTE]?.value;
  return typeof attributeValue === "string" && isUuidV4String(attributeValue)
    ? attributeValue
    : null;
}

/** Reads only the immutable per-transaction organization metadata. */
export function resolveOrganizationIdFromTransactionMetadata(
  event: RevenueCatWebhookEvent,
): string | null {
  const metadataValue = event.metadata?.[ORGANIZATION_SUBSCRIBER_ATTRIBUTE];
  return typeof metadataValue === "string" && isUuidV4String(metadataValue)
    ? metadataValue
    : null;
}

/**
 * The outcome of the immutable org resolution for one event: `resolved`
 * carries the org bound to the Stripe subscription; `none` means the event is
 * not from Stripe and ordinary store resolution applies; `error` means a
 * Stripe-store event could not be attributed immutably. The caller must defer
 * an unresolved Stripe event rather than fall back to the mutable subscriber
 * attribute, which can point at the wrong organization for a multi-org buyer.
 */
type StripeStoreOrgResolution =
  | {
      kind: "resolved";
      organizationId: string;
      priceId: string | null;
      seatCount: number | null;
    }
  | { kind: "none" }
  | { kind: "error" };

/**
 * Immutable org resolution for STRIPE-store events (direct checkout, issue
 * #1654). Stripe-store events do not always carry transaction metadata, and
 * the `orgId` subscriber attribute is customer-level and mutable — a
 * buyer admining several orgs would have every Stripe event resolve to
 * whichever org they purchased for LAST. But these events carry the Stripe
 * subscription or subscription-item id. A `sub_…` id can be looked up exactly
 * and the subscription's own metadata (written by our checkout) binds the org
 * immutably. An `si_…` id cannot be passed to the subscription endpoint; the
 * workflow resolves it through the durable local item binding before calling
 * this fallback.
 */
export async function resolveStripeStoreOrganizationId(
  event: RevenueCatWebhookEvent,
  deps: StripeApiDeps = {},
): Promise<StripeStoreOrgResolution> {
  if (event.store?.toUpperCase() !== STRIPE_STORE) {
    return { kind: "none" };
  }
  const identifiers = [
    event.original_transaction_id,
    event.transaction_id,
  ].filter((value): value is string => typeof value === "string");
  const subscriptionIds = [
    ...new Set(identifiers.filter((value) => value.startsWith("sub_"))),
  ];
  const subscriptionId = subscriptionIds[0];
  if (subscriptionIds.length !== 1 || !subscriptionId) {
    return { kind: "error" };
  }
  try {
    const binding = await getSubscriptionBinding(subscriptionId, deps);
    if (binding === null) {
      return { kind: "error" };
    }
    const subscriptionItemIds = [
      ...new Set(identifiers.filter((value) => value.startsWith("si_"))),
    ];
    if (
      subscriptionItemIds.length > 1 ||
      (subscriptionItemIds.length === 1 &&
        binding.subscriptionItemId !== subscriptionItemIds[0])
    ) {
      return { kind: "error" };
    }
    return binding.organizationId && isUuidV4String(binding.organizationId)
      ? {
          kind: "resolved",
          organizationId: binding.organizationId,
          priceId: binding.priceId,
          seatCount: binding.seatQuantity,
        }
      : { kind: "error" };
  } catch (error) {
    console.error(
      "Stripe subscription lookup for RevenueCat event failed:",
      error,
    );
    return { kind: "error" };
  }
}

function resolveEntitlementId(event: RevenueCatWebhookEvent): string | null {
  return event.entitlement_ids?.[0] ?? null;
}

function timestampMsToDate(value: number | null | undefined): Date | null {
  return value != null ? new Date(value) : null;
}

/** Product whose capacity a grant asserts after this event is applied. */
function resolveGrantedProductId(
  event: RevenueCatWebhookEvent,
  boundNativeProductId?: string,
): string | null {
  return event.product_id ?? boundNativeProductId ?? null;
}

interface RevenueCatClassificationOptions {
  allowSandboxEvents?: boolean;
  boundNativeProductId?: string;
  boundNativeSeatCount?: number;
  boundProviderSubscriptionId?: string;
  stripePriceId?: string;
  stripeSeatCount?: number;
}

function classifyRevenueCatGrant(
  event: RevenueCatWebhookEvent,
  now: Date,
  options: RevenueCatClassificationOptions,
): RevenueCatBillingTransition {
  if (event.store?.toUpperCase() === "RC_BILLING") {
    return {
      kind: "ignore",
      reason: "RevenueCat Web Billing grants are not supported",
    };
  }
  const isStripeStore = event.store?.toUpperCase() === STRIPE_STORE;
  const isPromotionalStore = event.store?.toUpperCase() === PROMOTIONAL_STORE;
  const grantedProductId = resolveGrantedProductId(
    event,
    options.boundNativeProductId,
  );
  const tier = isStripeStore
    ? null
    : getSyncBillingTierForNativeProduct(grantedProductId);
  const seatCount = isStripeStore
    ? options.stripeSeatCount
    : (options.boundNativeSeatCount ?? tier?.seatLimit);
  if (!seatCount) {
    if (
      !isStripeStore &&
      !grantedProductId &&
      BOUND_TIER_REUSE_EVENT_TYPES.has(event.type)
    ) {
      return { kind: "ignore", reason: BOUND_REVENUECAT_TIER_REQUIRED_REASON };
    }
    return {
      kind: "ignore",
      reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON,
    };
  }
  if (
    event.expiration_at_ms != null &&
    event.expiration_at_ms <= now.getTime()
  ) {
    return {
      kind: "ignore",
      reason: "Grant event period has already expired",
    };
  }
  return {
    kind: "grant",
    fields: {
      status: "active",
      provider: REVENUECAT_PROVIDER,
      providerCustomerId: event.app_user_id,
      // Stripe may carry the subscription id only in `transaction_id`.
      providerSubscriptionId:
        event.original_transaction_id ??
        (isStripeStore
          ? (event.transaction_id ?? null)
          : (options.boundProviderSubscriptionId ?? null)),
      // RevenueCat's Stripe catalog identifier is the Product, so retain the
      // exact Price resolved from our immutable subscription binding.
      providerProductId: isStripeStore
        ? (options.stripePriceId ?? event.product_id ?? null)
        : isPromotionalStore && grantedProductId
          ? `promotional:${grantedProductId}`
          : grantedProductId,
      providerTransactionId: event.transaction_id ?? null,
      entitlementId: resolveEntitlementId(event),
      currentPeriodStartsAt: timestampMsToDate(event.purchased_at_ms),
      currentPeriodEndsAt: timestampMsToDate(event.expiration_at_ms),
      trialEndsAt: null,
      disabledAt: null,
      purgeAfter: null,
      seatCount,
    },
  };
}

/**
 * Maps a RevenueCat event to its effect on an organization's sync billing,
 * independent of any database state. Grants activate sync and record the
 * provider/customer/entitlement; revokes disable sync and start the purge
 * grace window; everything else is ignored.
 *
 * `allowSandboxEvents` defaults to false so a tier that has not opted in
 * ignores store-sandbox purchases entirely — including their revokes, since
 * applying only half of a sandbox lifecycle could disable sync an org actually
 * paid for. Ignoring still records and acknowledges the event, so RevenueCat
 * stops redelivering it.
 */
export function classifyRevenueCatEvent(
  event: RevenueCatWebhookEvent,
  now: Date = new Date(),
  options: RevenueCatClassificationOptions = {},
): RevenueCatBillingTransition {
  if (isGuardedSandboxEvent(event) && options.allowSandboxEvents !== true) {
    return { kind: "ignore", reason: SANDBOX_IGNORED_REASON };
  }

  // RevenueCat documents PRODUCT_CHANGE as informational: it can describe an
  // immediate upgrade or a deferred downgrade, but it is not proof that the
  // destination product is effective. The database-aware workflow validates
  // it against the currently bound native subscription and records it as a
  // pending change; INITIAL_PURCHASE (Play) or RENEWAL (Apple) applies it.
  if (event.type === "PRODUCT_CHANGE") {
    return {
      kind: "ignore",
      reason: BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON,
    };
  }

  if (isRevenueCatGrantEventType(event.type)) {
    return classifyRevenueCatGrant(event, now, options);
  }

  if (REVOKE_EVENT_TYPES.has(event.type)) {
    return {
      kind: "revoke",
      fields: {
        status: "disabled",
        disabledAt: now,
        purgeAfter: new Date(now.getTime() + LAPSED_BILLING_PURGE_GRACE_MS),
      },
    };
  }

  return { kind: "ignore", reason: `Unhandled event type: ${event.type}` };
}
