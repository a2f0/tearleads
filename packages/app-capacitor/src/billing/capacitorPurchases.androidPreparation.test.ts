import { afterEach, expect, test } from "bun:test";
import { STORE_REPLACEMENT_MODE } from "@revenuecat/purchases-capacitor";
import {
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  PurchaseProviderStalledError,
  PurchasesUnavailableError,
} from "@symcrypt/client-sdk";
import {
  createCapacitorPurchases,
  fixture,
  nativePackage,
  resetFixture,
  setEnv,
} from "../../tests/billing/capacitorPurchasesTestKit";

afterEach(resetFixture);

test("purchases Android packages through the bounded native bridge", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "com.symcrypt.sync.monthly")];

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });

  expect(fixture.nativePrepareCalls).toEqual([
    { identifier: "monthly", productId: "com.symcrypt.sync.monthly" },
  ]);
  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "monthly", productId: "com.symcrypt.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("rejects a package whose identity changes after preparation", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  const aPackage = nativePackage("monthly", "com.symcrypt.sync.monthly");
  fixture.packages = [aPackage];
  fixture.onNativePrepare = () => {
    Object.assign(aPackage, { identifier: "changed" });
  };

  const error = await createCapacitorPurchases()
    .purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    })
    .catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(PurchasesUnavailableError);
  expect(error).toMatchObject({
    cause: {
      code: "bridge-invalid",
      message: "Purchase package was not prepared: monthly",
    },
    code: "bridge-invalid",
  });
  expect(fixture.nativePrepareCalls).toHaveLength(1);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("rejects an incomplete Play product change before preparation", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("team_5", "sync_team_5_monthly:monthly")];
  fixture.customerInfo = {
    entitlements: {
      active: {
        sync: {
          productIdentifier: "sync_solo_monthly:monthly",
          store: "PLAY_STORE",
        },
      },
    },
  };
  const replacementMode = STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE;
  Reflect.set(STORE_REPLACEMENT_MODE, "CHARGE_PRORATED_PRICE", undefined);
  try {
    await expect(
      createCapacitorPurchases().purchaseSync({
        organizationId: "org-1",
        packageId: "team_5",
      }),
    ).rejects.toThrow("Android product changes require both store fields");
  } finally {
    Reflect.set(
      STORE_REPLACEMENT_MODE,
      "CHARGE_PRORATED_PRICE",
      replacementMode,
    );
  }
  expect(fixture.nativePrepareCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("bounds Android native preparation before opening Play", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
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
