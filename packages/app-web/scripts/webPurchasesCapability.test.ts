import { expect, test } from "bun:test";
import { PurchasesUnavailableError } from "@symcrypt/client-sdk";
import { createWebPurchases } from "../src/webPurchases";

const ENV_KEY = "BUN_PUBLIC_REVENUECAT_WEB_API_KEY";

test("the web RevenueCat capability cannot start a flat-quantity purchase", async () => {
  const previous = process.env[ENV_KEY];
  process.env[ENV_KEY] = "rcb_test_observation_only";
  try {
    const purchases = createWebPurchases();

    expect(purchases.isAvailable).toBe(false);
    expect(purchases.supportsEmbeddedCheckout).toBe(false);
    expect(await purchases.listSyncOptions()).toEqual([]);
    await expect(
      purchases.purchaseSync({
        organizationId: "org-1",
        packageId: "monthly",
      }),
    ).rejects.toBeInstanceOf(PurchasesUnavailableError);
  } finally {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  }
});
