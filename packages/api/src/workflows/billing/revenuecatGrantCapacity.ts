import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import {
  BOUND_REVENUECAT_TIER_REQUIRED_REASON,
  classifyRevenueCatEvent,
  type RevenueCatBillingTransition,
  UNCONFIGURED_SYNC_BILLING_TIER_REASON,
} from "../../billing/revenuecatWebhook";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";

type RevenueCatGrantCapacityDisposition =
  | { readonly kind: "within_capacity" }
  | { readonly kind: "apply_without_reconciliation"; readonly reason: string };

const STRIPE_GRANT_EXCEEDS_CAPACITY_REASON =
  "Stripe subscription cannot cover more than 10 active members";
export const DEFERRED_NATIVE_DOWNGRADE_REASON =
  "Native subscription downgrade is deferred until renewal";

/** Resolves a product-less lifecycle grant only from its locked customer tier. */
export function resolveBoundRevenueCatGrantTransition(input: {
  readonly allowSandboxEvents: boolean;
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly now: Date;
  readonly transition: RevenueCatBillingTransition;
}): RevenueCatBillingTransition {
  let transition = input.transition;
  if (
    transition.kind === "ignore" &&
    transition.reason === BOUND_REVENUECAT_TIER_REQUIRED_REASON
  ) {
    const productId =
      input.billing?.provider === "revenuecat" &&
      input.billing.providerCustomerId === input.event.app_user_id
        ? input.billing.providerProductId
        : null;
    const tier = getSyncBillingTierForNativeProduct(productId);
    if (!tier || input.billing?.seatCount !== tier.seatLimit || !productId) {
      return { kind: "ignore", reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON };
    }
    transition = classifyRevenueCatEvent(input.event, input.now, {
      allowSandboxEvents: input.allowSandboxEvents,
      boundNativeProductId: productId,
      boundNativeSeatCount: tier.seatLimit,
      ...(input.billing.providerSubscriptionId
        ? { boundProviderSubscriptionId: input.billing.providerSubscriptionId }
        : {}),
    });
  }
  if (input.event.type !== "PRODUCT_CHANGE" || transition.kind !== "grant") {
    return transition;
  }
  const currentTier = getSyncBillingTierForNativeProduct(
    input.billing?.provider === "revenuecat" &&
      input.billing.providerCustomerId === input.event.app_user_id
      ? input.billing.providerProductId
      : null,
  );
  const destinationTier = getSyncBillingTierForNativeProduct(
    transition.fields.providerProductId,
  );
  return currentTier &&
    destinationTier &&
    destinationTier.seatLimit < currentTier.seatLimit
    ? { kind: "ignore", reason: DEFERRED_NATIVE_DOWNGRADE_REASON }
    : transition;
}

/**
 * Compares a paid grant with the authoritative signed Members projection.
 * Stripe state above the largest sellable tier is malformed and is claimed for
 * operator repair. A native under-tier purchase is still honored: app-store
 * purchase and roster mutation cannot share a transaction, so dropping the
 * paid grant would charge the customer without granting service.
 */
export async function resolveRevenueCatGrantCapacity(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly transition: RevenueCatBillingTransition;
}): Promise<RevenueCatGrantCapacityDisposition> {
  if (input.transition.kind !== "grant") {
    return { kind: "within_capacity" };
  }
  const [organization] = await input.executor
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) {
    return { kind: "within_capacity" };
  }
  const activeUserIds = await listUsersReachableFromCurrentGroup({
    executor: input.executor,
    groupId: organization.memberGroupId,
  });
  if (input.event.store?.toUpperCase() === "STRIPE") {
    return getSyncBillingTierForSeatCount(Math.max(1, activeUserIds.length))
      ? { kind: "within_capacity" }
      : {
          kind: "apply_without_reconciliation",
          reason: STRIPE_GRANT_EXCEEDS_CAPACITY_REASON,
        };
  }
  if (activeUserIds.length <= input.transition.fields.seatCount) {
    return { kind: "within_capacity" };
  }
  return {
    kind: "apply_without_reconciliation",
    reason:
      "Native subscription tier does not cover the organization's active members",
  };
}
