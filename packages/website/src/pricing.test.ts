import { expect, test } from "bun:test";
import { SYNC_BILLING_TIERS } from "@tearleads/validators/billing";
import {
  createPricingTiers,
  formatUsdCents,
  startingSyncPrice,
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
  const tiers = createPricingTiers();
  expect(tiers).toHaveLength(SYNC_BILLING_TIERS.length + 1);
  expect(tiers[0]).toMatchObject({
    name: "Free Forever",
    price: "$0",
    interval: "",
    capacity: "Local only, no sync",
    summary: "Your device only, no sync",
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
      summary:
        tier.seatLimit === 1
          ? "Encrypted sync for 1 member"
          : `Encrypted sync and sharing for up to ${tier.seatLimit} members`,
    });
  }
  expect(tiers[1]?.features).toContain(
    "End-to-end encrypted sync across your devices",
  );
  expect(tiers[2]?.features).toContain("Share folders with users and groups");
  expect(tiers[3]?.features).toContain("Share folders with users and groups");
});

test("every plan cross-reference names an earlier plan", () => {
  const tiers = createPricingTiers();
  let references = 0;
  for (const [index, tier] of tiers.entries()) {
    const earlier = tiers.slice(0, index).map((previous) => previous.name);
    for (const feature of tier.features) {
      const referenced = /^Everything in (.+)$/.exec(feature)?.[1];
      if (referenced === undefined) continue;
      references += 1;
      expect(earlier).toContain(referenced);
    }
  }
  expect(references).toBeGreaterThan(0);
});

test("plans carry no per-tier actions or marketing descriptions", () => {
  for (const tier of createPricingTiers()) {
    expect(tier).not.toHaveProperty("href");
    expect(tier).not.toHaveProperty("action");
    expect(tier).not.toHaveProperty("description");
  }
});

test("the member-capacity explanation follows canonical tier limits", () => {
  const capacities = SYNC_BILLING_TIERS.map((tier) => String(tier.seatLimit));
  expect(syncMemberCapacities).toBe(
    new Intl.ListFormat("en-US", { type: "disjunction" }).format(capacities),
  );
});

test("the starting sync price is the cheapest canonical tier", () => {
  expect(startingSyncPrice).toBe(
    formatUsdCents(
      Math.min(...SYNC_BILLING_TIERS.map((tier) => tier.monthlyPriceUsdCents)),
    ),
  );
});
