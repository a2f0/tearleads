import {
  SYNC_BILLING_TIERS,
  type SyncBillingTierId,
} from "@tearleads/validators/billing";

interface TierCopy {
  readonly description: string;
  readonly features: readonly string[];
}

const teamCopy: TierCopy = {
  description:
    "A shared organization with encrypted sync and control over who can access each container.",
  features: [
    "Everything in Free Forever",
    "End-to-end encrypted sync",
    "User and group sharing",
    "Read, write, and admin access",
  ],
};

const tierCopy: Record<SyncBillingTierId, TierCopy> = {
  solo: {
    description:
      "Your local workspace, with encrypted sync to keep your devices connected.",
    features: [
      "Everything in Free Forever",
      "End-to-end encrypted sync",
      "Sync across your devices",
    ],
  },
  team_5: teamCopy,
  team_10: teamCopy,
};

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

export const syncMemberCapacities = new Intl.ListFormat("en-US", {
  type: "disjunction",
}).format(SYNC_BILLING_TIERS.map((tier) => String(tier.seatLimit)));

export function createPricingTiers(appUrl: string) {
  return [
    {
      name: "Free Forever",
      price: formatUsdCents(0),
      interval: "forever",
      capacity: "Your local workspace",
      description:
        "A place for your notes, contacts, and files, stored locally on your device.",
      features: [
        "Notes, contacts, and Explorer",
        "Local encrypted storage",
        "Local backup and restore",
      ],
      href: appUrl,
      action: "Start locally",
    },
    ...SYNC_BILLING_TIERS.map((tier) => ({
      name: tier.title,
      price: formatUsdCents(tier.monthlyPriceUsdCents),
      interval: "/ month",
      capacity:
        tier.seatLimit === 1
          ? "1 organization member"
          : `Up to ${tier.seatLimit} organization members`,
      ...tierCopy[tier.id],
      href: appUrl,
      action: "Choose in the app",
    })),
  ];
}
