import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import {
  APP_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
  BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON,
  BOUND_REVENUECAT_TIER_REQUIRED_REASON,
  classifyRevenueCatEvent,
  NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
  type RevenueCatBillingTransition,
  UNCONFIGURED_SYNC_BILLING_TIER_REASON,
  UNKNOWN_REVENUECAT_PRODUCT_CHANGE_STORE_REASON,
} from "../../billing/revenuecatWebhook";
import {
  isNativeRevenueCatStore,
  isRecognizedNativeRevenueCatStore,
} from "./revenuecatBuyerPolicy";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";

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
  if (!isNativeRevenueCatStore(input.event.store)) {
    return {
      kind: "ignore",
      reason: NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
    };
  }
  if (!isRecognizedNativeRevenueCatStore(input.event.store)) {
    return {
      kind: "ignore",
      reason: UNKNOWN_REVENUECAT_PRODUCT_CHANGE_STORE_REASON,
    };
  }
  const currentTier = getSyncBillingTierForNativeProduct(
    input.billing?.provider === "revenuecat" &&
      input.billing.providerCustomerId === input.event.app_user_id
      ? input.billing.providerProductId
      : null,
  );
  const sourceTier = getSyncBillingTierForNativeProduct(input.event.product_id);
  // PRODUCT_CHANGE identifies the bound predecessor. The effective Play event
  // may later carry a replacement token, but this informational marker cannot
  // select an organization without the exact current subscription identity.
  if (
    !input.billing ||
    !currentTier ||
    !sourceTier ||
    input.billing.providerSubscriptionId !==
      input.event.original_transaction_id ||
    input.billing.seatCount !== currentTier.seatLimit
  ) {
    return {
      kind: "ignore",
      reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
    };
  }
  if (
    input.event.store?.toUpperCase() === "PLAY_STORE" &&
    !input.event.new_product_id
  ) {
    return {
      kind: "ignore",
      reason: PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
    };
  }
  if (
    input.event.store?.toUpperCase() === "APP_STORE" &&
    !input.event.new_product_id
  ) {
    return {
      kind: "ignore",
      reason: APP_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
    };
  }
  const destinationTier = getSyncBillingTierForNativeProduct(
    input.event.new_product_id,
  );
  if (!destinationTier) {
    return { kind: "ignore", reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON };
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
  if (
    transition.kind === "grant" &&
    isRecognizedNativeRevenueCatStore(input.event.store) &&
    !input.event.original_transaction_id &&
    input.billing?.provider === "revenuecat" &&
    input.billing.providerCustomerId === input.event.app_user_id &&
    input.billing.providerSubscriptionId
  ) {
    return {
      ...transition,
      fields: {
        ...transition.fields,
        providerSubscriptionId: input.billing.providerSubscriptionId,
      },
    };
  }
  return transition;
}
