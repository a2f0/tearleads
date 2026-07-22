import { expect, test } from "bun:test";
import { getSubscriptionBinding } from "./stripeSubscriptionBinding";

test("subscription binding reads the licensed sync item", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        current_period_start: 1_767_225_600,
        current_period_end: 1_769_904_000,
        metadata: { userId: "user-1", orgId: "org-1" },
        items: {
          data: [{ id: "si_1", quantity: 2, price: { id: "price_sync" } }],
        },
      }),
    )) as typeof fetch;

  const binding = await getSubscriptionBinding("sub_1", {
    env: {
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_SYNC_PRICE_ID: "price_sync",
    },
    fetchImpl,
  });

  expect(binding).toEqual({
    billingPeriodEndsAt: new Date("2026-02-01T00:00:00.000Z"),
    billingPeriodStartsAt: new Date("2026-01-01T00:00:00.000Z"),
    customerId: "cus_1",
    organizationId: "org-1",
    priceId: "price_sync",
    seatQuantity: 2,
    status: "active",
    subscriptionItemId: "si_1",
    userId: "user-1",
  });
});

test("subscription binding never guesses a seat item without a configured price", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "sub_1",
        status: "active",
        metadata: { userId: "user-1", orgId: "org-1" },
        items: {
          data: [{ id: "si_other", quantity: 7, price: { id: "price_other" } }],
        },
      }),
    )) as typeof fetch;

  const binding = await getSubscriptionBinding("sub_1", {
    env: { STRIPE_SECRET_KEY: "sk_test_123" },
    fetchImpl,
  });

  expect(binding).toMatchObject({
    organizationId: "org-1",
    priceId: null,
    seatQuantity: null,
    subscriptionItemId: null,
  });
});

test("subscription binding rejects an ambiguous duplicate seat item", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "sub_1",
        metadata: { orgId: "org-1" },
        items: {
          data: [
            { id: "si_1", quantity: 1, price: { id: "price_sync" } },
            { id: "si_2", quantity: 1, price: { id: "price_sync" } },
          ],
        },
      }),
    )) as typeof fetch;

  const binding = await getSubscriptionBinding("sub_1", {
    env: {
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_SYNC_PRICE_ID: "price_sync",
    },
    fetchImpl,
  });

  expect(binding).toMatchObject({
    priceId: null,
    seatQuantity: null,
    subscriptionItemId: null,
  });
});
