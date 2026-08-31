import { expect, test } from "bun:test";
import { createRevenueCatPurchases, type RevenueCatBackend } from "./purchases";

interface NativeMoveBackend extends RevenueCatBackend {
  readonly attributes: Record<string, string | null>;
  readonly calls: string[];
}

function createBackend(activeEntitlementIds: string[]): NativeMoveBackend {
  const attributes: Record<string, string | null> = {};
  const calls: string[] = [];
  return {
    attributes,
    calls,
    async configure() {},
    async getCurrentPackages() {
      return [];
    },
    async getCustomerInfo() {
      return { activeEntitlementIds: [] };
    },
    async logIn() {},
    async logOut() {},
    async purchasePackage() {
      return { activeEntitlementIds: [] };
    },
    async restorePurchases() {
      calls.push("restorePurchases");
      return { activeEntitlementIds };
    },
    async setAttributes(next) {
      calls.push("setAttributes");
      Object.assign(attributes, next);
    },
  };
}

function purchases(backend: RevenueCatBackend) {
  return createRevenueCatPurchases(backend, {
    apiKey: "key",
    nativeStore: "test_store",
    restorePurchasesUsesCheckoutTimeout: false,
    syncEntitlementId: "sync",
  });
}

test("native move rejects an entitlement-free restore before claiming or binding", async () => {
  const backend = createBackend([]);
  let claimAttempts = 0;

  await expect(
    purchases(backend).moveNativeSubscription({
      claim: async () => {
        claimAttempts += 1;
        return "org-new";
      },
      userId: "user-1",
    }),
  ).rejects.toThrow("The restored receipt has no sync entitlement");

  expect(claimAttempts).toBe(0);
  expect(backend.attributes).toEqual({});
  expect(backend.calls).toEqual(["restorePurchases"]);
});

test("native move rejects a denied server claim before binding", async () => {
  const backend = createBackend(["sync"]);
  const claimedStores: string[] = [];

  await expect(
    purchases(backend).moveNativeSubscription({
      claim: async (store) => {
        claimedStores.push(store);
        return null;
      },
      userId: "user-1",
    }),
  ).rejects.toThrow("The server did not accept the native subscription");

  expect(claimedStores).toEqual(["test_store"]);
  expect(backend.attributes).toEqual({});
  expect(backend.calls).toEqual(["restorePurchases"]);
});

test("native move binds the organization selected by the verified claim", async () => {
  const backend = createBackend(["sync"]);

  await expect(
    purchases(backend).moveNativeSubscription({
      claim: async () => "fresh-org",
      userId: "user-1",
    }),
  ).resolves.toEqual({ organizationId: "fresh-org" });

  expect(backend.attributes).toEqual({ orgId: "fresh-org" });
  expect(backend.calls).toEqual(["restorePurchases", "setAttributes"]);
});
