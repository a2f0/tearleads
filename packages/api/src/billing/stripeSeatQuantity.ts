import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import { resolveDeps, type StripeApiDeps, stripeRequest } from "./stripeHttp";

type StripeSeatProrationBehavior = "create_prorations" | "none";

interface StripeSeatQuantityUpdate {
  readonly subscriptionItemId: string;
  readonly seatQuantity: number;
  readonly prorationBehavior: StripeSeatProrationBehavior;
  readonly idempotencyKey: string;
}

/**
 * Rounds live seat state up to a fixed tier. Empty rosters retain Solo, and a
 * defensive clamp maps legacy oversized outbox state to Team 10 so the worker
 * can settle instead of retrying the same impossible target forever. Roster
 * writes and checkout reject new state above 10 before it reaches this helper.
 */
export function normalizeStripeSeatQuantity(seatQuantity: number): number {
  if (!Number.isSafeInteger(seatQuantity) || seatQuantity < 0) {
    throw new RangeError("Stripe seat quantity must be a non-negative integer");
  }
  const boundedSeatQuantity = Math.min(10, Math.max(1, seatQuantity));
  const tier = getSyncBillingTierForSeatCount(boundedSeatQuantity);
  if (!tier) throw new Error("Fixed billing tiers are not configured");
  return tier.seatLimit;
}

/** Switches the subscription item to the fixed tier covering the seat target. */
export async function updateSubscriptionItemQuantity(
  input: StripeSeatQuantityUpdate,
  deps: StripeApiDeps = {},
): Promise<boolean | null> {
  const tier = getSyncBillingTierForSeatCount(input.seatQuantity);
  if (!tier) {
    throw new RangeError("Stripe seat target exceeds the available tiers");
  }
  if (!input.idempotencyKey.trim()) {
    throw new RangeError(
      "Stripe seat update idempotency key must not be empty",
    );
  }
  const { fetchImpl, secretKey, syncPriceIds } = resolveDeps(deps);
  const priceId = syncPriceIds[tier.id];
  if (!secretKey || !priceId) {
    return null;
  }
  const form = new URLSearchParams();
  form.set("price", priceId);
  form.set("quantity", "1");
  form.set("proration_behavior", input.prorationBehavior);
  await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: `/v1/subscription_items/${encodeURIComponent(input.subscriptionItemId)}`,
    operation: "subscription item tier update",
    form,
    idempotencyKey: input.idempotencyKey,
  });
  return true;
}
