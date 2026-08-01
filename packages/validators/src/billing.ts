export const BILLING_ERROR_CODES = {
  checkoutNoActiveMembers: "billing_checkout_no_active_members",
  nativeTierUpgradeRequired: "billing_native_tier_upgrade_required",
  rosterOverCapacity: "billing_roster_over_capacity",
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

/** Canonical fixed-cap subscription tiers shared by every billing provider. */
export const SYNC_BILLING_TIERS = [
  {
    id: "solo",
    monthlyPriceUsdCents: 500,
    seatLimit: 1,
    title: "Solo",
  },
  {
    id: "team_5",
    monthlyPriceUsdCents: 1_000,
    seatLimit: 5,
    title: "Team (up to 5)",
  },
  {
    id: "team_10",
    monthlyPriceUsdCents: 2_000,
    seatLimit: 10,
    title: "Team (up to 10)",
  },
] as const;

export type SyncBillingTier = (typeof SYNC_BILLING_TIERS)[number];
export type SyncBillingTierId = SyncBillingTier["id"];

export function isSyncBillingTierId(
  value: unknown,
): value is SyncBillingTierId {
  return SYNC_BILLING_TIERS.some((tier) => tier.id === value);
}

export function getSyncBillingTier(tierId: SyncBillingTierId): SyncBillingTier {
  const tier = SYNC_BILLING_TIERS.find((candidate) => candidate.id === tierId);
  if (!tier) {
    throw new Error(`Unknown sync billing tier: ${tierId}`);
  }
  return tier;
}

/** Smallest tier that can cover a membership count, or null above the limit. */
export function getSyncBillingTierForSeatCount(
  seatCount: number,
): SyncBillingTier | null {
  if (!Number.isSafeInteger(seatCount) || seatCount < 1) {
    return null;
  }
  return SYNC_BILLING_TIERS.find((tier) => tier.seatLimit >= seatCount) ?? null;
}

/** Largest tier in the canonical ascending-capacity tier list. */
export function getLargestSyncBillingTier(): SyncBillingTier {
  const tier = SYNC_BILLING_TIERS.at(-1);
  if (!tier) {
    throw new Error("At least one sync billing tier must be configured");
  }
  return tier;
}

/**
 * Product identifiers used in App Store, Play, and RevenueCat Test Store.
 * Staging suffixes and Play base-plan suffixes do not change the tier.
 */
export function getSyncBillingTierForNativeProduct(
  productId: string | null | undefined,
): SyncBillingTier | null {
  if (!productId) {
    return null;
  }
  const normalized = productId.split(":", 1)[0] ?? "";
  if (
    normalized === "sync_monthly" ||
    normalized === "sync_monthly_staging" ||
    normalized === "com.tearleads.sync.monthly" ||
    normalized === "sync_solo_monthly" ||
    normalized === "sync_solo_monthly_staging"
  ) {
    return getSyncBillingTier("solo");
  }
  if (
    normalized === "sync_team_5_monthly" ||
    normalized === "sync_team_5_monthly_staging"
  ) {
    return getSyncBillingTier("team_5");
  }
  if (
    normalized === "sync_team_10_monthly" ||
    normalized === "sync_team_10_monthly_staging"
  ) {
    return getSyncBillingTier("team_10");
  }
  return null;
}
