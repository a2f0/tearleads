import type {
  OrganizationBillingProvider,
  OrganizationBillingStatus,
} from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { isUuidV4String } from "@tearleads/validators/util";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "./organizationBilling";

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
  entitlementId: string | null;
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
 * Resolves the organization a RevenueCat event is paying for from its `orgId`
 * subscriber attribute. Returns null when the attribute is missing or not a
 * valid organization id (which a caller treats as an ignorable event rather
 * than querying the database with a malformed id).
 */
export function resolveOrganizationIdFromEvent(
  event: RevenueCatWebhookEvent,
): string | null {
  const value =
    event.subscriber_attributes?.[ORGANIZATION_SUBSCRIBER_ATTRIBUTE]?.value;
  return typeof value === "string" && isUuidV4String(value) ? value : null;
}

function resolveEntitlementId(event: RevenueCatWebhookEvent): string | null {
  return event.entitlement_ids?.[0] ?? null;
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
        entitlementId: resolveEntitlementId(event),
        currentPeriodEndsAt:
          event.expiration_at_ms != null
            ? new Date(event.expiration_at_ms)
            : null,
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
