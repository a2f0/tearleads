import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { organizationBillingStripeSeats } from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import { eq } from "drizzle-orm";
import { blocksNativePurchaseForStripeCheckoutAttempt } from "./nativePurchaseEligibility";
import { isNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";
import {
  hasAppliedStripeExpiration,
  hasStripeBindingIdentity,
} from "./stripeBindingPolicy";

const NATIVE_GRANT_CONFLICTS_WITH_STRIPE_REASON =
  "Native entitlement is active while a retained Stripe subscription may still bill";
const NATIVE_GRANT_CONFLICTS_WITH_STRIPE_CHECKOUT_REASON =
  "Native purchase conflicts with an active web checkout";

const NATIVE_PURCHASE_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
]);

export function isNativePurchaseEventType(eventType: string): boolean {
  return NATIVE_PURCHASE_EVENT_TYPES.has(eventType);
}

function conflictsWithLockedBillingIdentity(
  billing: LockedBillingIdentity,
): boolean {
  const hasProviderIdentity = Boolean(
    billing.provider ||
      billing.providerCustomerId ||
      billing.providerProductId ||
      billing.providerSubscriptionId ||
      billing.providerTransactionId,
  );
  if (!hasProviderIdentity) {
    return billing.status === "active";
  }
  return !(
    billing.provider === "revenuecat" &&
    billing.providerSubscriptionId &&
    getSyncBillingTierForNativeProduct(billing.providerProductId)
  );
}

/** Detects a live Stripe identity that must remain available for cancellation. */
export async function resolveNativeStripeConflictReason(input: {
  readonly billing: LockedBillingIdentity;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly store: string | null | undefined;
}): Promise<string | null> {
  if (!isNativeRevenueCatStore(input.store)) {
    return null;
  }
  if (
    blocksNativePurchaseForStripeCheckoutAttempt({
      attemptExpiresAt: input.billing.checkoutAttemptExpiresAt,
      attemptId: input.billing.checkoutAttemptId,
      now: input.now,
    })
  ) {
    return NATIVE_GRANT_CONFLICTS_WITH_STRIPE_CHECKOUT_REASON;
  }
  const [binding] = await input.executor
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, input.organizationId),
    )
    .limit(1);
  const stripeBindingExpired = await hasAppliedStripeExpiration({
    billingStatus: input.billing.status,
    binding,
    executor: input.executor,
    organizationId: input.organizationId,
  });
  if (
    !stripeBindingExpired &&
    conflictsWithLockedBillingIdentity(input.billing)
  ) {
    return NATIVE_GRANT_CONFLICTS_WITH_STRIPE_REASON;
  }
  return hasStripeBindingIdentity(binding)
    ? stripeBindingExpired
      ? null
      : NATIVE_GRANT_CONFLICTS_WITH_STRIPE_REASON
    : null;
}
