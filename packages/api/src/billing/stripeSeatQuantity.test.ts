import { expect, test } from "bun:test";
import { getSyncBillingTierForStripePrice } from "./stripeHttp";
import {
  normalizeStripeSeatQuantity,
  updateSubscriptionItemQuantity,
} from "./stripeSeatQuantity";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_SOLO_PRICE_ID: "price_solo",
  STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
  STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
};

test("live Stripe seat state has an explicit one-seat floor", () => {
  expect(normalizeStripeSeatQuantity(0)).toBe(1);
  expect(normalizeStripeSeatQuantity(1)).toBe(1);
  expect(normalizeStripeSeatQuantity(4)).toBe(5);
  expect(normalizeStripeSeatQuantity(10)).toBe(10);
  expect(() => normalizeStripeSeatQuantity(11)).toThrow(RangeError);
  expect(() => normalizeStripeSeatQuantity(-1)).toThrow(RangeError);
});

test("configured Stripe prices map exactly to their fixed tiers", () => {
  expect(getSyncBillingTierForStripePrice("price_solo", { env: ENV })?.id).toBe(
    "solo",
  );
  expect(
    getSyncBillingTierForStripePrice("price_team_5", { env: ENV })?.id,
  ).toBe("team_5");
  expect(
    getSyncBillingTierForStripePrice("price_team_10", { env: ENV })?.id,
  ).toBe("team_10");
  expect(
    getSyncBillingTierForStripePrice("price_team_5_extra", { env: ENV }),
  ).toBeNull();
  expect(getSyncBillingTierForStripePrice(null, { env: ENV })).toBeNull();
});

test("sets absolute quantities with explicit proration and caller idempotency", async () => {
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Response.json({});
  }) as typeof fetch;
  const cases = [
    ["si/increase", 3, "create_prorations", "seat-event:increase-1"],
    ["si_reduce", 2, "none", "seat-event:reduce-1"],
  ] as const;

  for (const [
    subscriptionItemId,
    seatQuantity,
    prorationBehavior,
    key,
  ] of cases) {
    expect(
      await updateSubscriptionItemQuantity(
        {
          subscriptionItemId,
          seatQuantity,
          prorationBehavior,
          idempotencyKey: key,
        },
        { env: ENV, fetchImpl },
      ),
    ).toBe(true);
  }

  expect(
    await Promise.all(
      requests.map(async (request) => ({
        path: new URL(request.url).pathname,
        body: await request.text(),
        key: request.headers.get("Idempotency-Key"),
      })),
    ),
  ).toEqual([
    {
      path: "/v1/subscription_items/si%2Fincrease",
      body: "price=price_team_5&quantity=1&proration_behavior=create_prorations",
      key: "seat-event:increase-1",
    },
    {
      path: "/v1/subscription_items/si_reduce",
      body: "price=price_team_5&quantity=1&proration_behavior=none",
      key: "seat-event:reduce-1",
    },
  ]);
});

test("rejects invalid quantities and empty idempotency keys", async () => {
  const base = {
    subscriptionItemId: "si_1",
    seatQuantity: 1,
    prorationBehavior: "none" as const,
    idempotencyKey: "seat-event:1",
  };
  await expect(
    updateSubscriptionItemQuantity({ ...base, seatQuantity: 0 }, { env: ENV }),
  ).rejects.toBeInstanceOf(RangeError);
  await expect(
    updateSubscriptionItemQuantity(
      { ...base, idempotencyKey: " " },
      { env: ENV },
    ),
  ).rejects.toBeInstanceOf(RangeError);
});

test("returns null without a Stripe secret", async () => {
  expect(
    await updateSubscriptionItemQuantity(
      {
        subscriptionItemId: "si_1",
        seatQuantity: 2,
        prorationBehavior: "none",
        idempotencyKey: "seat-event:1",
      },
      { env: {} },
    ),
  ).toBeNull();
});
