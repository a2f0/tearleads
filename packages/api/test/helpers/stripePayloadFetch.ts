import { activeStripePrice } from "./stripeCatalog";
import { workersFetch } from "./workersFetch";

/** Fixtures for the malformed Stripe response tables. */

export const STRIPE_PAYLOAD_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_SOLO_PRICE_ID: "price_solo",
  STRIPE_SYNC_TEAM_5_PRICE_ID: "price_sync",
  STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
};

export const STRIPE_PAYLOAD_CHECKOUT = {
  checkoutAttemptId: "attempt-1",
  customerId: "cus_1",
  userId: "user-1",
  organizationId: "org-1",
  seatQuantity: 2,
};

/** The configured Team 5 Price, valid for its tier. */
export const STRIPE_PAYLOAD_PRICE = activeStripePrice("price_sync", 1_000);

/** JSON values that are not objects (arrays included). */
export const NON_OBJECT_PAYLOADS: readonly unknown[] = [null, 5, "x", true, []];

/** Answers each Stripe request with the next body, in order. */
export function queuedStripeFetch(bodies: unknown[]) {
  const requests: Array<{ method: string; url: string }> = [];
  const fetchImpl = workersFetch(async (input, init) => {
    requests.push({ method: init?.method ?? "GET", url: String(input) });
    const body = bodies.length > 0 ? bodies.shift() : {};
    return new Response(JSON.stringify(body));
  });
  return { fetchImpl, requests };
}

export function stripeSearchPage(data: unknown): unknown {
  return { data, has_more: false };
}
