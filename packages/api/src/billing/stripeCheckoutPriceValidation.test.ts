import { expect, test } from "bun:test";
import { createCheckoutSession, createSyncSubscription } from "./stripeApi";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_TEAM_5_PRICE_ID: "price_sync",
};
const TEAM_5_PRICE = {
  currency: "usd",
  id: "price_sync",
  recurring: { interval: "month", interval_count: 1 },
  unit_amount: 1_000,
};

function priceFetch(body: unknown, urls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(body);
  }) as unknown as typeof fetch;
}

test("subscription creation fails closed for a mispriced configured tier", async () => {
  const urls: string[] = [];
  const result = await createSyncSubscription(
    {
      checkoutAttemptId: "attempt-inline-invalid",
      customerId: "cus_1",
      organizationId: "org-1",
      seatQuantity: 2,
      userId: "user-1",
    },
    {
      env: ENV,
      fetchImpl: priceFetch({ ...TEAM_5_PRICE, unit_amount: 999 }, urls),
    },
  );

  expect(result).toBeNull();
  expect(urls).toEqual(["https://api.stripe.com/v1/prices/price_sync"]);
});

test("hosted checkout fails closed for a mispriced configured tier", async () => {
  const urls: string[] = [];
  const result = await createCheckoutSession(
    {
      checkoutAttemptId: "attempt-hosted-invalid",
      customerId: "cus_1",
      expiresAt: new Date("2030-01-01T00:45:00.000Z"),
      organizationId: "org-1",
      returnUrl: "https://app.example/billing",
      seatQuantity: 2,
      userId: "user-1",
    },
    {
      env: ENV,
      fetchImpl: priceFetch({ ...TEAM_5_PRICE, currency: "eur" }, urls),
    },
  );

  expect(result).toBeNull();
  expect(urls).toEqual(["https://api.stripe.com/v1/prices/price_sync"]);
});
