import { expect, test } from "bun:test";
import {
  createRevenueCatPurchases,
  createUnavailablePurchases,
  PurchasesUnavailableError,
  type RevenueCatBackend,
  type RevenueCatCustomerInfo,
  type RevenueCatPackage,
} from "./purchases";

interface RecordingBackend extends RevenueCatBackend {
  readonly calls: string[];
  readonly attributes: Record<string, string | null>;
}

function createFakeBackend(options?: {
  packages?: RevenueCatPackage[];
  entitlementsAfterPurchase?: string[];
  entitlementsNow?: string[];
}): RecordingBackend {
  const calls: string[] = [];
  const attributes: Record<string, string | null> = {};
  const purchaseInfo: RevenueCatCustomerInfo = {
    activeEntitlementIds: options?.entitlementsAfterPurchase ?? ["sync"],
  };
  const currentInfo: RevenueCatCustomerInfo = {
    activeEntitlementIds: options?.entitlementsNow ?? [],
  };
  return {
    calls,
    attributes,
    async configure() {
      calls.push("configure");
    },
    async logIn(input) {
      calls.push(`logIn:${input.appUserId}`);
    },
    async logOut() {
      calls.push("logOut");
    },
    async setAttributes(next) {
      calls.push("setAttributes");
      Object.assign(attributes, next);
    },
    async getCurrentPackages() {
      calls.push("getCurrentPackages");
      return options?.packages ?? [];
    },
    async purchasePackage(input) {
      calls.push(`purchasePackage:${input.packageId}`);
      return purchaseInfo;
    },
    async getCustomerInfo() {
      calls.push("getCustomerInfo");
      return currentInfo;
    },
    async restorePurchases() {
      calls.push("restorePurchases");
      return currentInfo;
    },
  };
}

const CONFIG = { apiKey: "key", syncEntitlementId: "sync" };

test("configures the backend lazily and only once", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  expect(backend.calls).toHaveLength(0); // no configure on construction

  await purchases.identify({ userId: "user-1" });
  await purchases.hasActiveSyncEntitlement();

  expect(backend.calls.filter((call) => call === "configure")).toHaveLength(1);
});

test("identify logs in with the user id as the app user id", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  await purchases.identify({ userId: "user-42" });
  expect(backend.calls).toContain("logIn:user-42");
});

test("listSyncOptions maps provider packages to display options", async () => {
  const backend = createFakeBackend({
    packages: [
      {
        identifier: "monthly",
        productIdentifier: "sync_monthly",
        title: "Sync",
        description: "Cloud sync",
        priceString: "$4.99",
      },
    ],
  });
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  const options = await purchases.listSyncOptions();
  expect(options).toEqual([
    {
      packageId: "monthly",
      productId: "sync_monthly",
      title: "Sync",
      description: "Cloud sync",
      priceLabel: "$4.99",
    },
  ]);
});

test("purchaseSync binds the org attribute before buying and reports the entitlement", async () => {
  const backend = createFakeBackend({ entitlementsAfterPurchase: ["sync"] });
  const purchases = createRevenueCatPurchases(backend, CONFIG);

  const result = await purchases.purchaseSync({
    organizationId: "org-9",
    packageId: "monthly",
  });

  expect(result.syncEntitlementActive).toBe(true);
  expect(backend.attributes).toEqual({ orgId: "org-9" });
  // The org attribute must be set before the purchase call.
  expect(backend.calls.indexOf("setAttributes")).toBeLessThan(
    backend.calls.indexOf("purchasePackage:monthly"),
  );
});

test("purchaseSync reports an inactive entitlement when the purchase grants none", async () => {
  const backend = createFakeBackend({ entitlementsAfterPurchase: [] });
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  const result = await purchases.purchaseSync({
    organizationId: "org-9",
    packageId: "monthly",
  });
  expect(result.syncEntitlementActive).toBe(false);
});

test("purchaseSync honors a custom organization attribute key", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, {
    ...CONFIG,
    organizationAttributeKey: "$organizationId",
  });
  await purchases.purchaseSync({ organizationId: "org-1", packageId: "p" });
  expect(backend.attributes).toEqual({ $organizationId: "org-1" });
});

test("hasActiveSyncEntitlement reflects the current customer entitlements", async () => {
  const withSync = createRevenueCatPurchases(
    createFakeBackend({ entitlementsNow: ["sync"] }),
    CONFIG,
  );
  const withoutSync = createRevenueCatPurchases(
    createFakeBackend({ entitlementsNow: ["other"] }),
    CONFIG,
  );
  expect(await withSync.hasActiveSyncEntitlement()).toBe(true);
  expect(await withoutSync.hasActiveSyncEntitlement()).toBe(false);
});

test("the unavailable stub degrades reads and rejects purchases", async () => {
  const purchases = createUnavailablePurchases();
  expect(purchases.isAvailable).toBe(false);
  expect(await purchases.listSyncOptions()).toEqual([]);
  expect(await purchases.hasActiveSyncEntitlement()).toBe(false);
  await purchases.identify({ userId: "user-1" }); // no throw
  expect(
    purchases.purchaseSync({ organizationId: "org-1", packageId: "p" }),
  ).rejects.toBeInstanceOf(PurchasesUnavailableError);
});
