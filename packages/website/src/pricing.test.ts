import { expect, test } from "bun:test";
import { SYNC_BILLING_TIERS } from "@tearleads/validators/billing";
import {
  createPricingTiers,
  formatUsdCents,
  syncMemberCapacities,
} from "./pricing";

test("prices preserve cents without adding decimals to whole-dollar tiers", () => {
  for (const [cents, formatted] of [
    [0, "$0"],
    [1, "$0.01"],
    [499, "$4.99"],
    [500, "$5"],
    [1050, "$10.50"],
    [2000, "$20"],
  ] as const) {
    expect(formatUsdCents(cents)).toBe(formatted);
  }
  for (const cents of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => formatUsdCents(cents)).toThrow(RangeError);
  }
});

test("the pricing page maps every canonical tier and the local free plan", () => {
  const appUrl = "https://app-staging.tearleads.com";
  const tiers = createPricingTiers(appUrl);
  expect(tiers).toHaveLength(SYNC_BILLING_TIERS.length + 1);
  expect(tiers[0]).toMatchObject({
    name: "Free Forever",
    price: "$0",
    interval: "forever",
    href: appUrl,
  });
  for (const [index, tier] of SYNC_BILLING_TIERS.entries()) {
    expect(tiers[index + 1]).toMatchObject({
      name: tier.title,
      price: formatUsdCents(tier.monthlyPriceUsdCents),
      interval: "/ month",
      capacity:
        tier.seatLimit === 1
          ? "1 organization member"
          : `Up to ${tier.seatLimit} organization members`,
      href: appUrl,
    });
    expect(tiers[index + 1]?.features).toContain("End-to-end encrypted sync");
  }
  expect(tiers[1]?.features).toContain("Sync across your devices");
  expect(tiers[2]?.features).toContain("User and group sharing");
  expect(tiers[3]?.features).toContain("User and group sharing");
});

test("the member-capacity explanation follows canonical tier limits", () => {
  const capacities = SYNC_BILLING_TIERS.map((tier) => String(tier.seatLimit));
  expect(syncMemberCapacities).toBe(
    new Intl.ListFormat("en-US", { type: "disjunction" }).format(capacities),
  );
});
