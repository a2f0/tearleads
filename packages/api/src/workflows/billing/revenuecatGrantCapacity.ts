import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import {
  BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON,
  BOUND_REVENUECAT_TIER_REQUIRED_REASON,
  classifyRevenueCatEvent,
  NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  type RevenueCatBillingTransition,
  UNCONFIGURED_SYNC_BILLING_TIER_REASON,
} from "../../billing/revenuecatWebhook";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";
import { isRecognizedNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";

type RevenueCatGrantCapacityDisposition =
  | { readonly kind: "within_capacity" }
  | { readonly kind: "apply_without_reconciliation"; readonly reason: string };

const STRIPE_GRANT_EXCEEDS_CAPACITY_REASON =
  "Stripe subscription cannot cover more than 10 active members";
const PROMOTIONAL_PRODUCT_PREFIX = "promotional:";
export const PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON =
  "Product change does not match a bound native subscription";

function resolveBoundNativeProduct(productId: string): {
  readonly isPromotional: boolean;
  readonly productId: string;
} {
  const isPromotional = productId.startsWith(PROMOTIONAL_PRODUCT_PREFIX);
  return {
    isPromotional,
    productId: isPromotional
      ? productId.slice(PROMOTIONAL_PRODUCT_PREFIX.length)
      : productId,
  };
}

function classifyBoundLifecycleGrant(input: {
  readonly allowSandboxEvents: boolean;
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly now: Date;
}): RevenueCatBillingTransition {
  const storedProductId =
    input.billing?.provider === "revenuecat" &&
    input.billing.providerCustomerId === input.event.app_user_id
      ? input.billing.providerProductId
      : null;
  if (!storedProductId || !input.billing) {
    return { kind: "ignore", reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON };
  }
  const { isPromotional, productId } =
    resolveBoundNativeProduct(storedProductId);
  const tier = getSyncBillingTierForNativeProduct(productId);
  if (!tier || (!isPromotional && input.billing.seatCount !== tier.seatLimit)) {
    return { kind: "ignore", reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON };
  }
  const classified = classifyRevenueCatEvent(input.event, input.now, {
    allowSandboxEvents: input.allowSandboxEvents,
    boundNativeProductId: productId,
    boundNativeSeatCount: isPromotional
      ? input.billing.seatCount
      : tier.seatLimit,
    ...(input.billing.providerSubscriptionId
      ? { boundProviderSubscriptionId: input.billing.providerSubscriptionId }
      : {}),
  });
  return isPromotional && classified.kind === "grant"
    ? {
        ...classified,
        fields: { ...classified.fields, providerProductId: storedProductId },
      }
    : classified;
}

function classifyBoundProductChange(input: {
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
}): RevenueCatBillingTransition {
  if (!isRecognizedNativeRevenueCatStore(input.event.store)) {
    return {
      kind: "ignore",
      reason: NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
    };
  }
  const currentTier = getSyncBillingTierForNativeProduct(
    input.billing?.provider === "revenuecat" &&
      input.billing.providerCustomerId === input.event.app_user_id
      ? input.billing.providerProductId
      : null,
  );
  const destinationTier = getSyncBillingTierForNativeProduct(
    input.event.new_product_id,
  );
  if (!destinationTier) {
    return { kind: "ignore", reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON };
  }
  if (
    !input.billing ||
    !currentTier ||
    input.billing.seatCount !== currentTier.seatLimit ||
    input.billing.providerSubscriptionId === null ||
    input.event.original_transaction_id !== input.billing.providerSubscriptionId
  ) {
    return {
      kind: "ignore",
      reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
    };
  }
  return { kind: "schedule", fields: { status: input.billing.status } };
}

/** Resolves transitions that require the organization's locked provider state. */
export function resolveBoundRevenueCatTransition(input: {
  readonly allowSandboxEvents: boolean;
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly now: Date;
  readonly transition: RevenueCatBillingTransition;
}): RevenueCatBillingTransition {
  let transition = input.transition;
  if (
    transition.kind === "ignore" &&
    transition.reason === BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON
  ) {
    return classifyBoundProductChange(input);
  }
  if (
    transition.kind === "ignore" &&
    transition.reason === BOUND_REVENUECAT_TIER_REQUIRED_REASON
  ) {
    transition = classifyBoundLifecycleGrant({
      allowSandboxEvents: input.allowSandboxEvents,
      billing: input.billing,
      event: input.event,
      now: input.now,
    });
  }
  return transition;
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
