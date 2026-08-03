import { expect, test } from "bun:test";
import {
  createRevenueCatPurchases,
  PurchaseIdentityPendingError,
  type RevenueCatBackend,
  type RevenueCatCustomerInfo,
} from "./purchases";

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("an overlapping checkout cannot overwrite the active organization", async () => {
  const attributes: Record<string, string | null> = {};
  const purchaseInputs: Array<{ packageId: string }> = [];
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const emptyInfo: RevenueCatCustomerInfo = { activeEntitlementIds: [] };
  const backend: RevenueCatBackend = {
    configure: async () => {},
    logIn: async () => {},
    logOut: async () => {},
    setAttributes: async (next) => Object.assign(attributes, next),
    getCurrentPackages: async () => [],
    purchasePackage: async (input) => {
      purchaseInputs.push(input);
      checkoutStarted.resolve();
      await checkout.promise;
      return { activeEntitlementIds: ["sync"] };
    },
    getCustomerInfo: async () => emptyInfo,
    restorePurchases: async () => emptyInfo,
  };
  const purchases = createRevenueCatPurchases(backend, {
    apiKey: "key",
    nativeStore: "test_store",
    syncEntitlementId: "sync",
  });
  await purchases.identify({ userId: "user-1" });
  const first = purchases.purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  await checkoutStarted.promise;

  await expect(
    purchases.purchaseSync({
      organizationId: "org-2",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseIdentityPendingError);
  expect(attributes).toEqual({ orgId: "org-1" });
  expect(purchaseInputs).toHaveLength(1);

  checkout.resolve();
  await first;
});
