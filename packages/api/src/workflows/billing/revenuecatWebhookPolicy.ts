import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { and, eq, gt, ne } from "drizzle-orm";
import {
  classifyRevenueCatEvent,
  type RevenueCatBillingTransition,
} from "../../billing/revenuecatWebhook";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { resolveRevenueCatBuyerIgnoredReason } from "./revenuecatBuyerPolicy";
import type {
  ImmutableStripeStoreOrgResolution,
  LockedBillingIdentity,
} from "./revenuecatStripeResolution";

export const SUPERSEDED_STRIPE_EVENT_REASON =
  "Stripe event does not own the current native entitlement";

export const UNRESOLVED_STRIPE_TIER_REASON =
  "Stripe subscription tier could not be resolved";

const REUSABLE_STRIPE_TIER_EVENT_TYPES = new Set([
  "RENEWAL",
  "SUBSCRIPTION_EXTENDED",
  "UNCANCELLATION",
]);

/** Locks the billing identity that all provider-policy decisions depend on. */
export async function lockRevenueCatBillingIdentity(
  executor: DatabaseSession,
  organizationId: string,
): Promise<LockedBillingIdentity | undefined> {
  const query = executor
    .select({
      provider: organizationBilling.provider,
      providerCustomerId: organizationBilling.providerCustomerId,
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);
  const [row] = await lockRowForUpdate(query);
  return row;
}

async function hasNewerAppliedEvent(
  executor: DatabaseSession,
  organizationId: string,
  event: RevenueCatWebhookEvent,
): Promise<boolean> {
  const [newer] = await executor
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, organizationId),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        // PRODUCT_CHANGE is informational and may be timestamped after the
        // effective store event, so it cannot make lifecycle events stale.
        ne(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        gt(
          revenuecatWebhookEvents.eventTimestamp,
          new Date(event.event_timestamp_ms),
        ),
      ),
    )
    .limit(1);
  return newer !== undefined;
}

/** Whether an attributed Stripe lifecycle event has lost provider ownership. */
export function isStripeEventSupersededByNative(
  billing: LockedBillingIdentity | undefined,
  resolution: ImmutableStripeStoreOrgResolution,
): boolean {
  return (
    resolution.kind === "resolved" &&
    billing?.status === "active" &&
    getSyncBillingTierForNativeProduct(billing.providerProductId) !== null
  );
}

/**
 * Safely keeps a known subscription alive after its configured Price rotates.
 * A new purchase or changed identity still fails closed; only lifecycle events
 * that exactly match the locked, previously applied Stripe binding may reuse
 * its already licensed fixed-tier capacity.
 */
export function resolveLockedStripeTierFallback(input: {
  readonly allowSandboxEvents: boolean;
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly now: Date;
  readonly resolution: Extract<
    ImmutableStripeStoreOrgResolution,
    { kind: "resolved" }
  >;
}): RevenueCatBillingTransition | null {
  const { billing } = input;
  if (
    !billing ||
    billing.provider !== "revenuecat" ||
    billing.providerCustomerId !== input.event.app_user_id ||
    billing.providerProductId === null ||
    billing.providerProductId !== input.resolution.priceId ||
    billing.providerSubscriptionId === null ||
    !input.resolution.identifiers.includes(billing.providerSubscriptionId) ||
    !getSyncBillingTierForSeatCount(billing.seatCount) ||
    !REUSABLE_STRIPE_TIER_EVENT_TYPES.has(input.event.type)
  ) {
    return null;
  }
  return classifyRevenueCatEvent(input.event, input.now, {
    allowSandboxEvents: input.allowSandboxEvents,
    stripePriceId: billing.providerProductId,
    stripeSeatCount: billing.seatCount,
  });
}

/** Returns the read-only reason an attributed event should not be applied. */
export async function resolveRevenueCatIgnoredReason(input: {
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string | null;
  readonly transition: RevenueCatBillingTransition;
}): Promise<string | null> {
  if (input.transition.kind === "ignore") {
    return input.transition.reason;
  }
  if (input.organizationId === null) {
    return "Event carried no organization id";
  }
  if (!input.billing) {
    return "Unknown organization";
  }
  if (
    input.transition.kind === "grant" ||
    input.transition.kind === "schedule"
  ) {
    const buyerIgnoredReason = await resolveRevenueCatBuyerIgnoredReason({
      currentProviderCustomerId: input.billing.providerCustomerId,
      currentProviderProductId: input.billing.providerProductId,
      event: input.event,
      executor: input.executor,
      organizationId: input.organizationId,
    });
    if (buyerIgnoredReason) {
      return buyerIgnoredReason;
    }
  }
  return (await hasNewerAppliedEvent(
    input.executor,
    input.organizationId,
    input.event,
  ))
    ? "A newer billing event has already been applied"
    : null;
}
