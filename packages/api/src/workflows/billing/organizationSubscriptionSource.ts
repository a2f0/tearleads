import type {
  OrganizationBillingProvider,
  OrganizationBillingStatus,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import type { OrganizationBillingSubscriptionSource } from "@tearleads/validators/response";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { getSyncBillingTierForStripePrice } from "../../billing/stripeHttp";

interface OrganizationSubscriptionOwnership {
  /** Our API may cancel the subscription through Stripe from any surface. */
  readonly canCancelDirectly: boolean;
  readonly subscriptionSource: OrganizationBillingSubscriptionSource | null;
}

/**
 * Which purchase system owns an organization's subscription, and whether the
 * Stripe cancellation endpoint applies to it. The billing snapshot and the
 * manage/cancel resolution both derive from this one decision so the client
 * never sees a plan switcher and a card checkout disagree about the owner.
 *
 * A native product wins while no priced Stripe binding is live, even if a
 * quarantined Stripe identity is retained until its final event. A Stripe
 * identity counts while it can still bill; once it has lapsed the
 * organization is free to enroll again. A remaining RevenueCat customer with
 * neither identity is treated as native so its store link stays reachable.
 */
export function resolveOrganizationSubscriptionOwnership(input: {
  readonly hasActiveStripeSubscription: boolean;
  readonly hasStripeSubscription: boolean;
  readonly provider: OrganizationBillingProvider | null;
  readonly providerCustomerId: string | null;
  readonly providerProductId: string | null;
  readonly status: OrganizationBillingStatus;
  readonly stripe?: StripeApiDeps;
}): OrganizationSubscriptionOwnership {
  const hasProviderSubscription = input.provider === "revenuecat";
  const stripeTier = hasProviderSubscription
    ? getSyncBillingTierForStripePrice(input.providerProductId, input.stripe)
    : null;
  const nativeTier = hasProviderSubscription
    ? getSyncBillingTierForNativeProduct(input.providerProductId)
    : null;
  const statusCanBill =
    input.status === "active" ||
    input.status === "past_due" ||
    input.status === "trialing";
  if (nativeTier !== null && !input.hasActiveStripeSubscription) {
    return {
      canCancelDirectly: input.hasStripeSubscription && statusCanBill,
      subscriptionSource: "native",
    };
  }
  const hasLiveStripeIdentity =
    input.hasActiveStripeSubscription || stripeTier !== null;
  if (hasLiveStripeIdentity && statusCanBill) {
    return { canCancelDirectly: true, subscriptionSource: "stripe" };
  }
  if (
    !hasLiveStripeIdentity &&
    hasProviderSubscription &&
    input.providerCustomerId
  ) {
    return {
      canCancelDirectly: input.hasStripeSubscription && statusCanBill,
      subscriptionSource: "native",
    };
  }
  return { canCancelDirectly: false, subscriptionSource: null };
}
