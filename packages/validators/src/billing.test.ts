import { expect, test } from "bun:test";
import {
  getLargestSyncBillingTier,
  getSyncBillingTierForNativeProduct,
  getSyncBillingTierForSeatCount,
  isSyncBillingTierId,
  SYNC_BILLING_TIERS,
} from "./billing";

test("fixed billing tiers preserve their public price and capacity contract", () => {
  expect(SYNC_BILLING_TIERS).toEqual([
    { id: "solo", monthlyPriceUsdCents: 500, seatLimit: 1, title: "Solo" },
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
  ]);
  expect(isSyncBillingTierId("team_5")).toBe(true);
  expect(isSyncBillingTierId("enterprise")).toBe(false);
  expect(getLargestSyncBillingTier().id).toBe("team_10");
});

test("seat counts map to the smallest tier that covers them", () => {
  expect(getSyncBillingTierForSeatCount(1)?.id).toBe("solo");
  expect(getSyncBillingTierForSeatCount(2)?.id).toBe("team_5");
  expect(getSyncBillingTierForSeatCount(5)?.id).toBe("team_5");
  expect(getSyncBillingTierForSeatCount(6)?.id).toBe("team_10");
  expect(getSyncBillingTierForSeatCount(10)?.id).toBe("team_10");
  expect(getSyncBillingTierForSeatCount(11)).toBeNull();
  expect(getSyncBillingTierForSeatCount(0)).toBeNull();
  expect(getSyncBillingTierForSeatCount(1.5)).toBeNull();
});

test("native product ids map exact production, staging, and Play base plans", () => {
  const cases = [
    ["sync_monthly", "solo"],
    ["sync_monthly_staging", "solo"],
    ["com.symcrypt.sync.monthly", "solo"],
    ["sync_solo_monthly", "solo"],
    ["sync_solo_monthly_staging", "solo"],
    ["symcrypt_sync_solo_monthly", "solo"],
    ["symcrypt_sync_solo_monthly_staging", "solo"],
    ["sync_team_5_monthly:monthly", "team_5"],
    ["sync_team_5_monthly_staging:monthly", "team_5"],
    ["symcrypt_sync_team_5_monthly", "team_5"],
    ["symcrypt_sync_team_5_monthly_staging", "team_5"],
    ["sync_team_10_monthly", "team_10"],
    ["sync_team_10_monthly_staging:monthly", "team_10"],
    ["symcrypt_sync_team_10_monthly", "team_10"],
    ["symcrypt_sync_team_10_monthly_staging", "team_10"],
  ] as const;

  for (const [productId, tierId] of cases) {
    expect(getSyncBillingTierForNativeProduct(productId)?.id).toBe(tierId);
  }
});

test("native product matching rejects unknown suffixes and malformed ids", () => {
  for (const productId of [
    "sync_solo_monthly_preview",
    "sync_team_5_monthly_anything",
    "sync_team_10_monthly_staging_extra",
    "sync_team_10_monthly_extra:monthly",
    "symcrypt_sync_team_10_monthly_preview",
    "SYNC_SOLO_MONTHLY",
    "",
  ]) {
    expect(getSyncBillingTierForNativeProduct(productId)).toBeNull();
  }
  expect(getSyncBillingTierForNativeProduct(null)).toBeNull();
});
