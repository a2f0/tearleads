import { SYNC_BILLING_TIERS } from "@tearleads/validators/billing";

export interface PricingTier {
  readonly name: string;
  readonly price: string;
  readonly interval: string;
  readonly capacity: string;
  readonly summary: string;
  readonly features: readonly string[];
}

const disjunction = new Intl.ListFormat("en-US", { type: "disjunction" });
const seatLimits = SYNC_BILLING_TIERS.map((tier) => tier.seatLimit);

export function formatUsdCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(
      "Price must be a non-negative integer number of cents",
    );
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Every plan capacity, e.g. "1, 5, or 10". */
export const syncMemberCapacities = disjunction.format(seatLimits.map(String));

/** The lowest monthly sync price, e.g. "$5". */
export const startingSyncPrice = formatUsdCents(
  Math.min(...SYNC_BILLING_TIERS.map((tier) => tier.monthlyPriceUsdCents)),
);

const freeTier: PricingTier = {
  name: "Free Forever",
  price: formatUsdCents(0),
  interval: "",
  capacity: "Local only, no sync",
  summary: "Your device only, no sync",
  features: [
    "Notes, contacts, files, and records",
    "Encrypted storage on your device",
    "Offline editing",
    "Password-protected backups",
  ],
};

// Plan cross-references follow the canonical names, so renaming a tier can't
// leave a card pointing at a plan that no longer exists.
const soloTitle =
  SYNC_BILLING_TIERS.find((tier) => tier.seatLimit === 1)?.title ??
  freeTier.name;

const soloFeatures: readonly string[] = [
  `Everything in ${freeTier.name}`,
  "End-to-end encrypted sync across your devices",
];

const teamFeatures: readonly string[] = [
  `Everything in ${soloTitle}`,
  "Share folders with users and groups",
  "Read, write, or admin access per folder",
];

export function createPricingTiers(): readonly PricingTier[] {
  return [
    freeTier,
    ...SYNC_BILLING_TIERS.map(
      (tier): PricingTier =>
        tier.seatLimit === 1
          ? {
              name: tier.title,
              price: formatUsdCents(tier.monthlyPriceUsdCents),
              interval: "/ month",
              capacity: "1 organization member",
              summary: "Encrypted sync for 1 member",
              features: soloFeatures,
            }
          : {
              name: tier.title,
              price: formatUsdCents(tier.monthlyPriceUsdCents),
              interval: "/ month",
              capacity: `Up to ${tier.seatLimit} organization members`,
              summary: `Encrypted sync and sharing for up to ${tier.seatLimit} members`,
              features: teamFeatures,
            },
    ),
  ];
}
