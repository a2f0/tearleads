import { afterEach, expect, test } from "bun:test";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import {
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  PurchaseProviderStalledError,
  PurchasesUnavailableError,
} from "@tearleads/client-sdk";
import {
  clearEnv,
  createCapacitorPurchases,
  fixture,
  nativePackage,
  purchaseSync,
  resetCachedPurchases,
  resetFixture,
  setEnv,
} from "../tests/capacitorPurchasesTestKit";

afterEach(resetFixture);

test("degrades to the unavailable stub without a platform key", () => {
  clearEnv();
  fixture.platform = "ios";
  expect(createCapacitorPurchases().isAvailable).toBe(false);
});

test("has no purchases in the Capacitor web preview even with native keys set", () => {
  // `cap run` in a browser has no store bridge. Both native keys are set to
  // prove the web branch is chosen by platform, not by key absence.
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "web";
  expect(createCapacitorPurchases().isAvailable).toBe(false);
});

test("configures the key belonging to the running platform", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");

  fixture.platform = "ios";
  await createCapacitorPurchases().identify({ userId: "user-1" });
  expect(fixture.configureCalls).toEqual([
    { apiKey: "ios-key", appUserID: "user-1" },
  ]);

  // Switching native platforms represents a new app process. Clear the
  // process-scoped singleton before simulating that second launch.
  resetCachedPurchases();
  fixture.configureCalls = [];
  fixture.platform = "android";
  await createCapacitorPurchases().identify({ userId: "user-1" });
  expect(fixture.configureCalls).toEqual([
    { apiKey: "android-key", appUserID: "user-1" },
  ]);
  expect(fixture.nativeConfigurationChecks).toBe(0);
});

test("maps RevenueCat public keys and platforms to the claim store", () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "test_project_key");
  fixture.platform = "ios";
  expect(createCapacitorPurchases().nativeStore).toBe("test_store");

  resetCachedPurchases();
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "appl_project_key");
  expect(createCapacitorPurchases().nativeStore).toBe("app_store");

  resetCachedPurchases();
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "goog_project_key");
  fixture.platform = "android";
  expect(createCapacitorPurchases().nativeStore).toBe("play_store");
});

test("configures onto the known buyer rather than an anonymous customer", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");

  await createCapacitorPurchases().identify({ userId: "user-1" });

  // Configuring anonymously and aliasing on the following logIn leaves a
  // stray anonymous RevenueCat customer behind for every fresh install.
  expect(fixture.configureCalls).toEqual([
    { apiKey: "ios-key", appUserID: "user-1" },
  ]);
  expect(fixture.logInCalls).toEqual([]);
});

test("logs in when the configured app changes to another buyer", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  const purchases = createCapacitorPurchases();

  await purchases.identify({ userId: "user-1" });
  await purchases.identify({ userId: "user-2" });

  expect(fixture.configureCalls).toEqual([
    { apiKey: "ios-key", appUserID: "user-1" },
  ]);
  expect(fixture.logInCalls).toEqual(["user-2"]);
});

test("configures without a buyer when the sdk has not identified one", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");

  // Entitlement observation can be the first call the capability sees; the
  // plugin must not receive an explicit undefined appUserID.
  await createCapacitorPurchases().hasActiveSyncEntitlement();

  expect(fixture.configureCalls).toEqual([{ apiKey: "ios-key" }]);
});

test("reset is idempotent when RevenueCat is already anonymous", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.logOutRejection = { code: "22" };
  const purchases = createCapacitorPurchases();

  await purchases.reset();
  expect(fixture.logOutCalls).toBe(1);
  expect(await purchases.hasActiveSyncEntitlement()).toBe(true);
});

test("reset preserves a genuine RevenueCat log-out failure", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  const providerError = { code: "2", message: "Store unavailable" };
  fixture.logOutRejection = providerError;

  const error = await createCapacitorPurchases()
    .reset()
    .then(
      () => null,
      (rejection: unknown) => rejection,
    );
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject(providerError);
  expect((error as Error).cause).toBe(providerError);
});

test("lists the current offering's packages as sync options", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  const options = await createCapacitorPurchases().listSyncOptions();

  expect(options).toEqual([
    {
      packageId: "monthly",
      productId: "com.tearleads.sync.monthly",
      title: "Solo",
      description: "Organization sync",
      priceLabel: "$4.99",
      tierId: "solo",
      seatLimit: 1,
    },
  ]);
});

test("binds the purchase to the organization before presenting the sheet", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  const result = await purchaseSync();

  // The server webhook resolves a non-Stripe store event against this
  // subscriber attribute, so it must be set before the purchase, not after.
  expect(fixture.attributeCalls).toEqual([{ orgId: "org-1" }]);
  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "monthly", productId: "com.tearleads.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(result.syncEntitlementActive).toBe(true);
});

test("bounds a stalled Android offerings read before opening Play", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.offeringsPromise = new Promise(() => {});

  await expect(
    createCapacitorPurchases({ operationTimeoutMs: 5 }).purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("an Android tier upgrade charges the prorated price difference", async () => {
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

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "team_5",
  });

  expect(fixture.nativePurchaseCalls).toEqual([
    {
      identifier: "team_5",
      oldProductIdentifier: "sync_solo_monthly",
      productId: "sync_team_5_monthly:monthly",
      replacementMode: "CHARGE_PRORATED_PRICE",
    },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("an Android tier downgrade waits for the next renewal", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("team_5", "sync_team_5_monthly:monthly")];
  fixture.customerInfo = {
    entitlements: {
      active: {
        sync: {
          productIdentifier: "sync_team_10_monthly:monthly",
          store: "PLAY_STORE",
        },
      },
    },
  };

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "team_5",
  });

  expect(fixture.nativePurchaseCalls).toEqual([
    {
      identifier: "team_5",
      oldProductIdentifier: "sync_team_10_monthly",
      productId: "sync_team_5_monthly:monthly",
      replacementMode: "DEFERRED",
    },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("an iOS tier change lets the subscription group determine timing", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.platform = "ios";
  fixture.packages = [nativePackage("team_5", "sync_team_5_monthly")];
  fixture.customerInfo = {
    entitlements: {
      active: {
        sync: {
          productIdentifier: "sync_solo_monthly",
          store: "APP_STORE",
        },
      },
    },
  };

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "team_5",
  });

  // StoreKit derives upgrade/downgrade behavior from the products' shared
  // subscription group and service levels; unlike Play it accepts no old
  // product or replacement mode in this purchase call.
  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "team_5", productId: "sync_team_5_monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("reports the entitlement as inactive when the purchase does not grant it", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  fixture.customerInfo = { entitlements: { active: { other: {} } } };

  const result = await purchaseSync();

  expect(result.syncEntitlementActive).toBe(false);
});

test("normalizes malformed entitlement ids from the iOS bridge", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  fixture.nativePurchaseResult = {};
  const missing = await purchaseSync();
  expect(missing.syncEntitlementActive).toBe(false);

  fixture.nativePurchaseResult = {
    activeEntitlementIds: ["sync", 7, null],
  };
  const mixed = await purchaseSync();
  expect(mixed.syncEntitlementActive).toBe(true);
});

test("honors a sync entitlement id overridden for this build", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  setEnv("VITE_REVENUECAT_SYNC_ENTITLEMENT", "sync_staging");
  fixture.customerInfo = { entitlements: { active: { sync_staging: {} } } };

  expect(await createCapacitorPurchases().hasActiveSyncEntitlement()).toBe(
    true,
  );
});

test("survives a malformed customer info from the native bridge", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  // The bridge is untyped at runtime; a partial payload must read as "no
  // entitlement" rather than throwing on a missing `entitlements`.
  fixture.customerInfo = undefined;

  expect(await createCapacitorPurchases().hasActiveSyncEntitlement()).toBe(
    false,
  );
});

test("rejects a stale package whose product is not a configured tier", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [{ identifier: "monthly" } as unknown as PurchasesPackage];

  expect(await createCapacitorPurchases().listSyncOptions()).toEqual([]);

  await expect(purchaseSync()).rejects.toThrow(
    "Unknown sync subscription product",
  );
  expect(fixture.nativePurchaseCalls).toEqual([]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("fails closed when the native bridge cannot validate", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  const bridgeError = {
    code: "bridge-invalid",
    message: "RevenueCat purchase failed",
    data: { userCancelled: false },
  };
  fixture.nativePurchaseRejection = bridgeError;

  const error = await purchaseSync().catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(PurchasesUnavailableError);
  expect(error).toMatchObject({
    cause: bridgeError,
    code: "bridge-invalid",
  });

  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "monthly", productId: "com.tearleads.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("rejects a package the current offering does not contain", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  await expect(purchaseSync("annual")).rejects.toThrow(
    "Unknown purchase package: annual",
  );
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("treats a dismissed store sheet as a cancellation, not a failure", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  // Match the first-party Swift plugin's CAPPluginCall.reject payload rather
  // than the official bridge's PurchasesError serialization.
  fixture.nativePurchaseRejection = {
    code: "1",
    message: "RevenueCat purchase failed",
    data: { userCancelled: true },
  };

  // Without the normalization the panel shows "Failed to subscribe" every
  // time a buyer backs out of the sheet: useSubscribeAction only treats
  // PurchaseCancelledError as a no-op.
  await expect(purchaseSync()).rejects.toBeInstanceOf(PurchaseCancelledError);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("normalizes cancellation from the Android RevenueCat bridge", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  fixture.nativePurchaseRejection = { code: "1" };

  await expect(purchaseSync()).rejects.toBeInstanceOf(PurchaseCancelledError);
  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "monthly", productId: "com.tearleads.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
});

test("normalizes an already-owned Android product into subscription recovery", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "sync_solo_monthly:monthly")];
  fixture.nativePurchaseRejection = { code: "6" };

  await expect(purchaseSync()).rejects.toBeInstanceOf(
    PurchaseAlreadyOwnedError,
  );
});

test("normalizes iOS receipt-ownership conflicts into subscription recovery", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.platform = "ios";
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  for (const code of ["6", "7", "13"]) {
    fixture.nativePurchaseRejection = { code };
    await expect(purchaseSync()).rejects.toBeInstanceOf(
      PurchaseAlreadyOwnedError,
    );
  }
});

test("propagates a genuine store failure unchanged", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  fixture.nativePurchaseRejection = {
    code: "2",
    message: "There was a problem with the store.",
  };

  const error = await purchaseSync().then(
    () => null,
    (rejection: unknown) => rejection,
  );

  // A store problem must stay a failure the panel surfaces; only a dismissal
  // is a no-op.
  expect(error).not.toBeInstanceOf(PurchaseCancelledError);
  expect(error).toEqual({
    code: "2",
    message: "There was a problem with the store.",
  });
  expect(fixture.purchaseCalls).toEqual([]);
});

test("does not present a sheet for a purchase abandoned before it began", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  const controller = new AbortController();
  controller.abort();

  // A presented StoreKit / Play sheet cannot be dismissed programmatically,
  // so the abort has to land before it goes up or not at all.
  await expect(
    purchaseSync("monthly", controller.signal),
  ).rejects.toBeInstanceOf(PurchaseAbortedError);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("does not present a sheet when abandoned while offerings loaded", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  const controller = new AbortController();
  // Abort during the fetch, not before it: this is the real window, since a
  // caller can only cancel while something is still on screen to cancel.
  fixture.onGetOfferings = () => controller.abort();

  await expect(
    purchaseSync("monthly", controller.signal),
  ).rejects.toBeInstanceOf(PurchaseAbortedError);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("prefers the pre-sheet abort over an unknown package", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [];
  const controller = new AbortController();
  fixture.onGetOfferings = () => controller.abort();

  await expect(
    purchaseSync("annual", controller.signal),
  ).rejects.toBeInstanceOf(PurchaseAbortedError);
});
