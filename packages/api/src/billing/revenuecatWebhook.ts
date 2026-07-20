import type {
  OrganizationBillingProvider,
  OrganizationBillingStatus,
} from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { isUuidV4String } from "@tearleads/validators/util";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "./organizationBilling";
import {
  getSubscriptionBinding,
  type StripeApiDeps,
  StripeApiError,
} from "./stripeApi";

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
 * Event types that assert the entitlement is currently granted. RevenueCat
 * keeps the entitlement (and the `expiration_at_ms` it reports) valid through
 * billing-issue grace periods, so any of these transitions the org to `active`.
 */
const GRANT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
]);

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
}

interface RevenueCatRevokeFields {
  status: OrganizationBillingStatus;
  disabledAt: Date;
  purgeAfter: Date;
}

/**
 * The billing effect a RevenueCat event has on an organization, computed purely
 * from the event. `grant`/`revoke` carry the exact `organization_billing`
 * columns to write; `ignore` records why the event was a no-op (unknown type,
 * cancellation-without-lapse, …).
 */
export type RevenueCatBillingTransition =
  | { kind: "grant"; fields: RevenueCatGrantFields }
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
 * carry no metadata — native store purchases, and events emitted before the
 * metadata stamping shipped.
 *
 * Returns null when neither source holds a valid organization id (which a
 * caller treats as an ignorable event rather than querying the database with a
 * malformed id).
 */
export function resolveOrganizationIdFromEvent(
  event: RevenueCatWebhookEvent,
): string | null {
  const metadataValue = event.metadata?.[ORGANIZATION_SUBSCRIBER_ATTRIBUTE];
  if (typeof metadataValue === "string" && isUuidV4String(metadataValue)) {
    return metadataValue;
  }
  const attributeValue =
    event.subscriber_attributes?.[ORGANIZATION_SUBSCRIBER_ATTRIBUTE]?.value;
  return typeof attributeValue === "string" && isUuidV4String(attributeValue)
    ? attributeValue
    : null;
}

/**
 * The outcome of the immutable org resolution for one event: `resolved`
 * carries the org bound to the Stripe subscription; `none` means the event
 * has no such binding to consult (not a Stripe-store event, no subscription
 * id, or a subscription our checkout did not create) and ordinary resolution
 * applies; `error` means the binding EXISTS in principle but could not be
 * read (lookup unconfigured or failed) — the caller must defer the event
 * rather than fall back to the mutable attribute, which for a multi-org
 * buyer can point at the wrong organization.
 */
export type StripeStoreOrgResolution =
  | { kind: "resolved"; organizationId: string }
  | { kind: "none" }
  | { kind: "error" };

/**
 * Immutable org resolution for STRIPE-store events (direct checkout, issue
 * #1654). RevenueCat forwards no transaction metadata for the Stripe store,
 * and the `orgId` subscriber attribute is customer-level and mutable — a
 * buyer admining several orgs would have every Stripe event resolve to
 * whichever org they purchased for LAST. But these events carry the Stripe
 * subscription id, and the subscription's own metadata (written by our
 * checkout) binds the org immutably — so it is the authoritative source for
 * this store.
 */
export async function resolveStripeStoreOrganizationId(
  event: RevenueCatWebhookEvent,
  deps: StripeApiDeps = {},
): Promise<StripeStoreOrgResolution> {
  if (event.store?.toUpperCase() !== "STRIPE") {
    return { kind: "none" };
  }
  const subscriptionId =
    event.original_transaction_id ?? event.transaction_id ?? null;
  if (!subscriptionId) {
    return { kind: "none" };
  }
  try {
    const binding = await getSubscriptionBinding(subscriptionId, deps);
    if (binding === null) {
      // Unconfigured lookup (no STRIPE_SECRET_KEY): our checkout cannot have
      // created any bound subscriptions in this deployment, so Stripe-store
      // events here are from a pre-existing integration and ordinary
      // resolution is the pre-PR behavior. (Removing the key while direct-
      // checkout subscriptions exist is an operator error: their renewals
      // would fall back to the mutable attribute until it is restored.)
      return { kind: "none" };
    }
    return binding.organizationId && isUuidV4String(binding.organizationId)
      ? { kind: "resolved", organizationId: binding.organizationId }
      : // A Stripe subscription without our metadata was not created by this
        // checkout; ordinary resolution applies.
        { kind: "none" };
  } catch (error) {
    // A definitive 404 means the transaction id is not a fetchable
    // subscription on our account — e.g. a purchase predating this checkout
    // or a one-time purchase token. That is "not ours", not a transient
    // failure: deferring it would retry-loop forever.
    if (error instanceof StripeApiError && error.status === 404) {
      return { kind: "none" };
    }
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

/**
 * Maps a RevenueCat event to its effect on an organization's sync billing,
 * independent of any database state. Grants activate sync and record the
 * provider/customer/entitlement; revokes disable sync and start the purge
 * grace window; everything else is ignored.
 */
export function classifyRevenueCatEvent(
  event: RevenueCatWebhookEvent,
  now: Date = new Date(),
): RevenueCatBillingTransition {
  if (GRANT_EVENT_TYPES.has(event.type)) {
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
        // Stripe-store events may carry the subscription id only in
        // `transaction_id`; without the fallback the billing row would store
        // no subscription id and the Billing Portal could never resolve the
        // org's subscription. Other stores keep the canonical original id.
        providerSubscriptionId:
          event.original_transaction_id ??
          (event.store?.toUpperCase() === "STRIPE"
            ? (event.transaction_id ?? null)
            : null),
        providerProductId: event.product_id ?? null,
        providerTransactionId: event.transaction_id ?? null,
        entitlementId: resolveEntitlementId(event),
        currentPeriodStartsAt: timestampMsToDate(event.purchased_at_ms),
        currentPeriodEndsAt: timestampMsToDate(event.expiration_at_ms),
        trialEndsAt: null,
        disabledAt: null,
        purgeAfter: null,
      },
    };
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
