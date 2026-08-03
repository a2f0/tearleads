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

test("purchases Android packages through the bounded native bridge", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });

  expect(fixture.nativePrepareCalls).toEqual([
    { identifier: "monthly", productId: "com.tearleads.sync.monthly" },
  ]);
  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "monthly", productId: "com.tearleads.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("bounds Android native preparation before opening Play", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
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
