import { z } from "zod";

export const BILLING_ERROR_CODES = {
  checkoutNoActiveMembers: "billing_checkout_no_active_members",
  rosterOverCapacity: "billing_roster_over_capacity",
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

/** Native subscription stores supported by the RevenueCat ownership flow. */
export const NATIVE_SUBSCRIPTION_STORES = [
  "app_store",
  "play_store",
  "test_store",
] as const;

export const NativeSubscriptionStoreSchema = z.literal(
  NATIVE_SUBSCRIPTION_STORES,
);

export type NativeSubscriptionStore = z.infer<
  typeof NativeSubscriptionStoreSchema
>;

export function isNativeSubscriptionStore(
  value: unknown,
): value is NativeSubscriptionStore {
  return NativeSubscriptionStoreSchema.safeParse(value).success;
}

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

export const SyncBillingTierIdSchema = z.literal(
  SYNC_BILLING_TIERS.map((tier) => tier.id),
);

export type SyncBillingTierId = z.infer<typeof SyncBillingTierIdSchema>;

export function isSyncBillingTierId(
  value: unknown,
): value is SyncBillingTierId {
  return SyncBillingTierIdSchema.safeParse(value).success;
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
 * The older Solo aliases remain only while existing Test Store fixtures and
 * installed sandbox receipts are migrated to `sync_solo_monthly`.
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
    normalized === "com.symcrypt.sync.monthly" ||
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
