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
  const normalized = productId.toLowerCase().split(":", 1)[0] ?? "";
  if (
    normalized === "sync_monthly" ||
    normalized === "sync_monthly_staging" ||
    normalized === "com.tearleads.sync.monthly" ||
    normalized.startsWith("sync_solo_monthly")
  ) {
    return getSyncBillingTier("solo");
  }
  if (normalized.startsWith("sync_team_5_monthly")) {
    return getSyncBillingTier("team_5");
  }
  if (normalized.startsWith("sync_team_10_monthly")) {
    return getSyncBillingTier("team_10");
  }
  return null;
}
