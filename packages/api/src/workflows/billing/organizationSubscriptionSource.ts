import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  type OrganizationBillingStatus,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import type { OrganizationBillingSubscriptionSource } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { getSyncBillingTierForStripePrice } from "../../billing/stripeHttp";
import {
  hasActiveStripeBinding,
  hasStripeBindingIdentity,
} from "./stripeBindingPolicy";

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
 *
 * `status` must be the persisted status, never the in-memory lapse
 * projection: a paid period that has ended while its renewal webhook is still
 * in flight is still owned, and offering a second checkout there would race
 * the renewal (the server would refuse it anyway).
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
    input.status === "active" || input.status === "trialing";
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

/**
 * Resolves the owner of an organization's subscription inside an open
 * transaction, from its persisted billing row and Stripe binding.
 */
export async function resolveOrganizationSubscriptionOwnershipInTransaction(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly persisted: {
    readonly provider: OrganizationBillingProvider | null;
    readonly providerCustomerId: string | null;
    readonly providerProductId: string | null;
    readonly status: OrganizationBillingStatus;
  };
  readonly stripe?: StripeApiDeps;
}): Promise<OrganizationSubscriptionOwnership> {
  const [stripeBinding] = await input.executor
    .select({
      priceId: organizationBillingStripeSeats.priceId,
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, input.organizationId),
    )
    .limit(1);
  return resolveOrganizationSubscriptionOwnership({
    hasActiveStripeSubscription: hasActiveStripeBinding(stripeBinding),
    hasStripeSubscription: hasStripeBindingIdentity(stripeBinding),
    provider: input.persisted.provider,
    providerCustomerId: input.persisted.providerCustomerId,
    providerProductId: input.persisted.providerProductId,
    status: input.persisted.status,
    ...(input.stripe ? { stripe: input.stripe } : {}),
  });
}
