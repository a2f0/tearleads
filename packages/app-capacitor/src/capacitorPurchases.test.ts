import { afterEach, expect, mock, test } from "bun:test";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import {
  PurchaseAbortedError,
  PurchaseCancelledError,
} from "@tearleads/client-sdk";

// Mutable fixture the mocked native bridge reads and records into. Each test
// arms the platform, the offerings the bridge reports, and the rejection (if
// any) `purchasePackage` should throw.
const fixture: {
  platform: string;
  configureCalls: { apiKey: string; appUserID?: string }[];
  purchaseCalls: { identifier: string }[];
  nativePurchaseCalls: { identifier: string; productId: string }[];
  attributeCalls: Record<string, string | null>[];
  packages: PurchasesPackage[];
  purchaseRejection: unknown;
  customerInfo: unknown;
  nativePurchaseResult: { activeEntitlementIds?: unknown } | null;
  onGetOfferings: (() => void) | null;
} = {
  platform: "ios",
  configureCalls: [],
  purchaseCalls: [],
  nativePurchaseCalls: [],
  attributeCalls: [],
  packages: [],
  purchaseRejection: null,
  customerInfo: { entitlements: { active: { sync: {} } } },
  nativePurchaseResult: null,
  onGetOfferings: null,
};

// A package shaped like the native bridge returns one. Cast at the boundary:
// the plugin's PurchasesPackage carries far more than the adapter reads, and
// the adapter's whole job is to survive a partial payload.
function nativePackage(identifier: string, productId: string) {
  return {
    identifier,
    product: {
      identifier: productId,
      title: "Sync",
      description: "Organization sync",
      priceString: "$4.99",
    },
  } as unknown as PurchasesPackage;
}

// `mock.module` is process-global, so this and the sibling adapter tests share
// one @capacitor/core. Supply the whole surface the siblings stub
// (capacitorNetworkStatus.test.ts adds isPluginAvailable) rather than relying on
// which file bun loads first.
mock.module("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => fixture.platform,
    isNativePlatform: () => fixture.platform !== "web",
    isPluginAvailable: () => fixture.platform !== "web",
    registerPlugin: (name: string) => {
      if (name !== "RevenueCatPurchase") {
        return { show: () => Promise.resolve() };
      }
      return {
        purchasePackage: ({
          packageId,
          productId,
        }: {
          packageId: string;
          productId: string;
        }) => {
          fixture.nativePurchaseCalls.push({
            identifier: packageId,
            productId,
          });
          if (fixture.purchaseRejection !== null) {
            return Promise.reject(fixture.purchaseRejection);
          }
          if (fixture.nativePurchaseResult !== null) {
            return Promise.resolve(fixture.nativePurchaseResult);
          }
          const customerInfo = fixture.customerInfo;
          const activeEntitlements =
            typeof customerInfo === "object" &&
            customerInfo !== null &&
            "entitlements" in customerInfo &&
            typeof customerInfo.entitlements === "object" &&
            customerInfo.entitlements !== null &&
            "active" in customerInfo.entitlements &&
            typeof customerInfo.entitlements.active === "object" &&
            customerInfo.entitlements.active !== null
              ? Object.keys(customerInfo.entitlements.active)
              : [];
          return Promise.resolve({ activeEntitlementIds: activeEntitlements });
        },
      };
    },
  },
}));

mock.module("@revenuecat/purchases-capacitor", () => ({
  // Mirrors the real enum in @revenuecat/purchases-typescript-internal-esm,
  // which the plugin re-exports. Only the member the adapter matches on is
  // needed; the string value is part of RevenueCat's public contract.
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: "1" },
  Purchases: {
    configure: (options: { apiKey: string; appUserID?: string }) => {
      fixture.configureCalls.push(options);
      return Promise.resolve();
    },
    logIn: () => Promise.resolve(),
    logOut: () => Promise.resolve(),
    setAttributes: (attributes: Record<string, string | null>) => {
      fixture.attributeCalls.push(attributes);
      return Promise.resolve();
    },
    getOfferings: () => {
      // Hook so a test can abort *during* the offerings fetch — the window the
      // post-fetch abort check exists to cover.
      fixture.onGetOfferings?.();
      return Promise.resolve({
        current: { availablePackages: fixture.packages },
      });
    },
    purchasePackage: ({ aPackage }: { aPackage: PurchasesPackage }) => {
      fixture.purchaseCalls.push({ identifier: aPackage.identifier });
      if (fixture.purchaseRejection !== null) {
        return Promise.reject(fixture.purchaseRejection);
      }
      return Promise.resolve({ customerInfo: fixture.customerInfo });
    },
    getCustomerInfo: () =>
      Promise.resolve({ customerInfo: fixture.customerInfo }),
    restorePurchases: () =>
      Promise.resolve({ customerInfo: fixture.customerInfo }),
  },
}));

// Imported after the module mocks so the source binds to them, not the real
// native bridge.
const { createCapacitorPurchases } = await import("./capacitorPurchases");

const ENV_KEYS = [
  "VITE_REVENUECAT_IOS_API_KEY",
  "VITE_REVENUECAT_ANDROID_API_KEY",
  "VITE_REVENUECAT_SYNC_ENTITLEMENT",
] as const;

// The adapter reads these through `import.meta.env`, which Bun backs with
// process.env. Set through a helper so the indexed access stays in one place
// rather than repeating a bracket-quoted key in every test.
function setEnv(key: (typeof ENV_KEYS)[number], value: string): void {
  process.env[key] = value;
}

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  fixture.platform = "ios";
  fixture.configureCalls = [];
  fixture.purchaseCalls = [];
  fixture.nativePurchaseCalls = [];
  fixture.attributeCalls = [];
  fixture.packages = [];
  fixture.purchaseRejection = null;
  fixture.customerInfo = { entitlements: { active: { sync: {} } } };
  fixture.nativePurchaseResult = null;
  fixture.onGetOfferings = null;
  clearEnv();
});

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

  fixture.configureCalls = [];
  fixture.platform = "android";
  await createCapacitorPurchases().identify({ userId: "user-1" });
  expect(fixture.configureCalls).toEqual([
    { apiKey: "android-key", appUserID: "user-1" },
  ]);
});

test("configures onto the known buyer rather than an anonymous customer", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");

  await createCapacitorPurchases().identify({ userId: "user-1" });

  // Configuring anonymously and aliasing on the following logIn leaves a
  // stray anonymous RevenueCat customer behind for every fresh install.
  expect(fixture.configureCalls).toEqual([
    { apiKey: "ios-key", appUserID: "user-1" },
  ]);
});

test("configures without a buyer when the sdk has not identified one", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");

  // restore()/hasActiveSyncEntitlement() can be the first call the capability
  // sees; the plugin must not receive an explicit undefined appUserID.
  await createCapacitorPurchases().restore();

  expect(fixture.configureCalls).toEqual([{ apiKey: "ios-key" }]);
});

test("lists the current offering's packages as sync options", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  const options = await createCapacitorPurchases().listSyncOptions();

  expect(options).toEqual([
    {
      packageId: "monthly",
      productId: "com.tearleads.sync.monthly",
      title: "Sync",
      description: "Organization sync",
      priceLabel: "$4.99",
    },
  ]);
});

test("binds the purchase to the organization before presenting the sheet", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  const result = await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });

  // The server webhook resolves a non-Stripe store event against this
  // subscriber attribute, so it must be set before the purchase, not after.
  expect(fixture.attributeCalls).toEqual([{ orgId: "org-1" }]);
  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "monthly", productId: "com.tearleads.sync.monthly" },
  ]);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(result.syncEntitlementActive).toBe(true);
});

test("keeps Android purchases on RevenueCat's official Capacitor bridge", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });

  expect(fixture.purchaseCalls).toEqual([{ identifier: "monthly" }]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("reports the entitlement as inactive when the purchase does not grant it", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  fixture.customerInfo = { entitlements: { active: { other: {} } } };

  const result = await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });

  expect(result.syncEntitlementActive).toBe(false);
});

test("normalizes malformed entitlement ids from the iOS bridge", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  fixture.nativePurchaseResult = {};
  const missing = await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  expect(missing.syncEntitlementActive).toBe(false);

  fixture.nativePurchaseResult = {
    activeEntitlementIds: ["sync", 7, null],
  };
  const mixed = await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
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

test("survives a malformed package from the native bridge", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [{ identifier: "monthly" } as unknown as PurchasesPackage];

  expect(await createCapacitorPurchases().listSyncOptions()).toEqual([
    {
      packageId: "monthly",
      productId: "",
      title: "",
      description: "",
      priceLabel: "",
    },
  ]);

  await createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  expect(fixture.nativePurchaseCalls).toEqual([
    { identifier: "monthly", productId: "" },
  ]);
});

test("rejects a package the current offering does not contain", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];

  await expect(
    createCapacitorPurchases().purchaseSync({
      organizationId: "org-1",
      packageId: "annual",
    }),
  ).rejects.toThrow("Unknown purchase package: annual");
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("treats a dismissed store sheet as a cancellation, not a failure", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  // Match the first-party Swift plugin's CAPPluginCall.reject payload rather
  // than the official bridge's PurchasesError serialization.
  fixture.purchaseRejection = {
    code: "1",
    message: "RevenueCat purchase failed",
    data: { userCancelled: true },
  };

  // Without the normalization the panel shows "Failed to subscribe" every
  // time a buyer backs out of the sheet: useSubscribeAction only treats
  // PurchaseCancelledError as a no-op.
  await expect(
    createCapacitorPurchases().purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseCancelledError);
});

test("normalizes cancellation from the Android RevenueCat bridge", async () => {
  setEnv("VITE_REVENUECAT_ANDROID_API_KEY", "android-key");
  fixture.platform = "android";
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  fixture.purchaseRejection = { code: "1" };

  await expect(
    createCapacitorPurchases().purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseCancelledError);
  expect(fixture.purchaseCalls).toEqual([{ identifier: "monthly" }]);
});

test("propagates a genuine store failure unchanged", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  fixture.purchaseRejection = {
    code: "2",
    message: "There was a problem with the store.",
  };

  const error = await createCapacitorPurchases()
    .purchaseSync({ organizationId: "org-1", packageId: "monthly" })
    .then(
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
});

test("does not present a sheet for a purchase abandoned before it began", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
  const controller = new AbortController();
  controller.abort();

  // A presented StoreKit / Play sheet cannot be dismissed programmatically,
  // so the abort has to land before it goes up or not at all.
  await expect(
    createCapacitorPurchases().purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
      abortSignal: controller.signal,
    }),
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
    createCapacitorPurchases().purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
      abortSignal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(PurchaseAbortedError);
  expect(fixture.purchaseCalls).toEqual([]);
  expect(fixture.nativePurchaseCalls).toEqual([]);
});

test("prefers the pre-sheet abort over an unknown package", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [];
  const controller = new AbortController();
  // Aborted during the fetch so the precedence is decided at the post-fetch
  // check; a pre-aborted signal would short-circuit before the lookup and the
  // ordering would go untested.
  fixture.onGetOfferings = () => controller.abort();

  // An abandoned flow's outcome stays a pre-sheet abort so callers can rely on
  // PurchaseAbortedError meaning "nothing was ever shown".
  await expect(
    createCapacitorPurchases().purchaseSync({
      organizationId: "org-1",
      packageId: "annual",
      abortSignal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(PurchaseAbortedError);
});

test("restores prior purchases through the native bridge", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  const purchases = createCapacitorPurchases();

  await purchases.restore();

  // Restore must configure the SDK first; a restore on a fresh install is the
  // first call the capability sees.
  expect(fixture.configureCalls).toEqual([{ apiKey: "ios-key" }]);
});
