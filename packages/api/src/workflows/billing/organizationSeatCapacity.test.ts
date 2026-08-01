import { expect, test } from "bun:test";
import { requiredLicensedSeatCount } from "./organizationSeatCapacity";

function billing(input: {
  readonly hasStripeSubscription?: boolean;
  readonly productId?: string | null;
  readonly seatCount?: number;
  readonly status?: "active" | "trialing";
}) {
  return {
    hasStripeSubscription: input.hasStripeSubscription ?? false,
    providerProductId: input.productId ?? null,
    seatCount: input.seatCount ?? 1,
    status: input.status ?? ("active" as const),
  };
}

test("a trial uses canonical tiers and cannot grow past ten members", () => {
  expect(requiredLicensedSeatCount(billing({ status: "trialing" }), 2)).toBe(5);
  expect(() =>
    requiredLicensedSeatCount(billing({ status: "trialing" }), 11, 10),
  ).toThrow("exceeds the maximum subscription tier");
});

test("an over-capacity trial may shrink while retaining the largest tier", () => {
  expect(
    requiredLicensedSeatCount(billing({ status: "trialing" }), 11, 12),
  ).toBe(10);
});

test("a native tier blocks growth but permits an over-capacity shrink", () => {
  const solo = billing({ productId: "sync_solo_monthly" });
  expect(() => requiredLicensedSeatCount(solo, 2, 1)).toThrow(
    "Upgrade the subscription",
  );
  expect(requiredLicensedSeatCount(solo, 2, 3)).toBe(1);
});

test("a Stripe subscription selects and clamps canonical tiers", () => {
  const stripe = billing({ hasStripeSubscription: true });
  expect(requiredLicensedSeatCount(stripe, 2)).toBe(5);
  expect(requiredLicensedSeatCount(stripe, 11, 12)).toBe(10);
});

test("an unbound active row still records canonical tier capacity", () => {
  expect(requiredLicensedSeatCount(billing({}), 2)).toBe(5);
});
