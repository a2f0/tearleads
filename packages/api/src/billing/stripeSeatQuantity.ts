import { resolveDeps, type StripeApiDeps, stripeRequest } from "./stripeHttp";

type StripeSeatProrationBehavior = "create_prorations" | "none";

interface StripeSeatQuantityUpdate {
  readonly subscriptionItemId: string;
  readonly seatQuantity: number;
  readonly prorationBehavior: StripeSeatProrationBehavior;
  readonly idempotencyKey: string;
}

/**
 * A live sync subscription always retains one billable seat, even when its
 * effective Members group is temporarily empty. This keeps the Stripe item and
 * RevenueCat entitlement continuous; initial checkout still rejects an empty
 * roster rather than creating a one-seat subscription for nobody.
 */
export function normalizeStripeSeatQuantity(seatQuantity: number): number {
  if (!Number.isSafeInteger(seatQuantity) || seatQuantity < 0) {
    throw new RangeError("Stripe seat quantity must be a non-negative integer");
  }
  return Math.max(1, seatQuantity);
}

export function serializeStripeSeatQuantity(seatQuantity: number): string {
  if (!Number.isSafeInteger(seatQuantity) || seatQuantity < 1) {
    throw new RangeError("Stripe seat quantity must be a positive integer");
  }
  return String(seatQuantity);
}

/** Sets an absolute paid-seat quantity with caller-selected proration. */
export async function updateSubscriptionItemQuantity(
  input: StripeSeatQuantityUpdate,
  deps: StripeApiDeps = {},
): Promise<boolean | null> {
  const seatQuantity = serializeStripeSeatQuantity(input.seatQuantity);
  if (!input.idempotencyKey.trim()) {
    throw new RangeError(
      "Stripe seat update idempotency key must not be empty",
    );
  }
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const form = new URLSearchParams();
  form.set("quantity", seatQuantity);
  form.set("proration_behavior", input.prorationBehavior);
  await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: `/v1/subscription_items/${encodeURIComponent(input.subscriptionItemId)}`,
    operation: "subscription item quantity update",
    form,
    idempotencyKey: input.idempotencyKey,
  });
  return true;
}
