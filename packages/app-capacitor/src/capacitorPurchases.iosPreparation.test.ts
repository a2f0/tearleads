import { afterEach, expect, test } from "bun:test";
import { PurchaseProviderStalledError } from "@tearleads/client-sdk";
import {
  createCapacitorPurchases,
  fixture,
  nativePackage,
  resetFixture,
  setEnv,
} from "../tests/capacitorPurchasesTestKit";

afterEach(resetFixture);

test("bounds the iOS diagnostic lookup before opening StoreKit", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.platform = "ios";
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  fixture.nativePreparePromise = new Promise(() => {});

  await expect(
    createCapacitorPurchases({ operationTimeoutMs: 5 }).purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
  expect(fixture.nativePrepareCalls).toEqual([
    { identifier: "monthly", productId: "com.tearleads.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});
