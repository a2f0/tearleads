import { afterEach, expect, test } from "bun:test";
import {
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  PurchaseProviderStalledError,
  PurchasesUnavailableError,
} from "@tearleads/client-sdk";
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

test("aborts after product-change lookup without preparing Play", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "sync_solo_monthly:monthly")];
  const controller = new AbortController();
  fixture.onGetCustomerInfo = () => controller.abort();

  await expect(
    createCapacitorPurchases().purchaseSync({
      abortSignal: controller.signal,
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseAbortedError);

  expect(fixture.nativePrepareCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("fails closed when Android package preparation cannot validate", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "sync_solo_monthly:monthly")];
  const bridgeError = {
    code: "bridge-invalid",
    message: "RevenueCat purchase failed",
    data: { userCancelled: false },
  };
  fixture.nativePrepareRejection = bridgeError;

  const error = await createCapacitorPurchases()
    .purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    })
    .catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(PurchasesUnavailableError);
  expect(error).toMatchObject({
    cause: bridgeError,
    code: "bridge-invalid",
  });
  expect(fixture.nativePrepareCalls).toEqual([
    { identifier: "monthly", productId: "sync_solo_monthly:monthly" },
  ]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test.each([
  "1",
  "6",
  "7",
  "13",
])("does not treat preparation error %s as a purchase outcome", async (code) => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "sync_solo_monthly:monthly")];
  const providerError = { code, message: "Preparation failed" };
  fixture.nativePrepareRejection = providerError;

  const error = await createCapacitorPurchases()
    .purchaseSync({ organizationId: "org-1", packageId: "monthly" })
    .then(
      () => null,
      (rejection: unknown) => rejection,
    );

  expect(error).toBe(providerError);
  expect(error).not.toBeInstanceOf(PurchaseCancelledError);
  expect(error).not.toBeInstanceOf(PurchaseAlreadyOwnedError);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("normalizes an aborted preparation failure before checkout", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "sync_solo_monthly:monthly")];
  const controller = new AbortController();
  fixture.nativePrepareRejection = { code: "2" };
  fixture.onNativePrepare = () => controller.abort();

  await expect(
    createCapacitorPurchases().purchaseSync({
      abortSignal: controller.signal,
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseAbortedError);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});
