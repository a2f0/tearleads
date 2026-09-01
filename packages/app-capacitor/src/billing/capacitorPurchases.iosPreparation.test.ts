import { afterEach, expect, test } from "bun:test";
import { PurchaseProviderStalledError } from "@symcrypt/client-sdk";
import {
  createCapacitorPurchases,
  fixture,
  nativePackage,
  resetFixture,
  setEnv,
} from "../../tests/billing/capacitorPurchasesTestKit";

afterEach(resetFixture);

test("bounds iOS package preparation before opening StoreKit", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.platform = "ios";
  fixture.packages = [nativePackage("monthly", "com.symcrypt.sync.monthly")];
  fixture.nativePreparePromise = new Promise(() => {});

  await expect(
    createCapacitorPurchases({ operationTimeoutMs: 5 }).purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
  expect(fixture.nativePrepareCalls).toEqual([
    { identifier: "monthly", productId: "com.symcrypt.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("reports presentation only after native preparation completes", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.platform = "ios";
  fixture.packages = [nativePackage("monthly", "com.symcrypt.sync.monthly")];
  const events: string[] = [];
  fixture.onNativePrepare = () => events.push("prepare");
  fixture.onNativePurchase = () => events.push("purchase");

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
    onProviderPresented: () => events.push("presented"),
  });

  expect(events).toEqual(["prepare", "presented", "purchase"]);
});
