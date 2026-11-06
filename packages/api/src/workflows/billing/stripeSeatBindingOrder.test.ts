import { expect, test } from "bun:test";
import { resolveStripeSeatBindingOrder } from "./stripeSeatBindingOrder";

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

function binding(
  subscriptionId: string | null,
  startsAt: number | null,
  endsAt: number | null,
  subscriptionItemId: string | null = null,
) {
  return {
    billingPeriodEndsAt: endsAt === null ? null : day(endsAt),
    billingPeriodStartsAt: startsAt === null ? null : day(startsAt),
    subscriptionId,
    subscriptionItemId,
  };
}

test("a candidate without a durable current subscription is accepted", () => {
  for (const current of [undefined, binding(null, 1, 10)]) {
    expect(
      resolveStripeSeatBindingOrder({
        billingProviderSubscriptionId: null,
        candidate: binding("sub_new", 1, 10),
        current,
      }),
    ).toBe("accepted");
  }
});

test("the same subscription advances on equal, later, or extended periods", () => {
  const order = (candidate: ReturnType<typeof binding>) =>
    resolveStripeSeatBindingOrder({
      billingProviderSubscriptionId: null,
      candidate,
      current: binding("sub_a", 5, 10),
    });
  expect(order(binding("sub_a", 5, 10))).toBe("accepted");
  expect(order(binding("sub_a", 10, 20))).toBe("accepted");
  expect(order(binding("sub_a", 5, 15))).toBe("accepted");
  expect(order(binding("sub_a", 6, 12))).toBe("retry");
  expect(order(binding("sub_a", 1, 5))).toBe("retry");
  expect(order(binding("sub_a", null, 12))).toBe("accepted");
});

test("a different subscription orders by non-overlapping periods first", () => {
  const order = (candidate: ReturnType<typeof binding>) =>
    resolveStripeSeatBindingOrder({
      billingProviderSubscriptionId: null,
      candidate,
      current: binding("sub_a", 5, 10),
    });
  expect(order(binding("sub_b", 10, 20))).toBe("accepted");
  expect(order(binding("sub_b", 1, 5))).toBe("stale");
  expect(order(binding("sub_b", 6, 12))).toBe("retry");
  expect(order(binding("sub_b", null, 12))).toBe("retry");
});

test("overlapping or unknown periods defer to the RevenueCat identity", () => {
  const order = (
    billingProviderSubscriptionId: string | null,
    candidate: ReturnType<typeof binding>,
  ) =>
    resolveStripeSeatBindingOrder({
      billingProviderSubscriptionId,
      candidate,
      current: binding("sub_a", 5, 10, "si_a"),
    });
  expect(order("sub_b", binding("sub_b", 6, 12))).toBe("accepted");
  expect(order("si_b", binding("sub_b", null, null, "si_b"))).toBe("accepted");
  expect(order("sub_a", binding("sub_b", 6, 12))).toBe("stale");
  expect(order("si_a", binding("sub_b", null, 12))).toBe("stale");
  expect(order("sub_c", binding("sub_b", 6, 12))).toBe("retry");
});
