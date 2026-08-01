interface StripeBindingIdentity {
  readonly subscriptionId: string | null;
  readonly subscriptionItemId: string | null;
}

interface ActiveStripeBinding extends StripeBindingIdentity {
  readonly priceId: string | null;
}

/** A retained Stripe identity can still require an explicit cancellation. */
export function hasStripeBindingIdentity(
  binding: StripeBindingIdentity | undefined,
): boolean {
  return Boolean(binding?.subscriptionId || binding?.subscriptionItemId);
}

/** Only a priced Stripe binding owns entitlement and licensed-seat state. */
export function hasActiveStripeBinding(
  binding: ActiveStripeBinding | undefined,
): boolean {
  return binding?.priceId != null && hasStripeBindingIdentity(binding);
}
