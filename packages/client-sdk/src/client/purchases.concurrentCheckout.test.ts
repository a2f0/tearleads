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

function createFixture() {
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
  return {
    attributes,
    checkout,
    checkoutStarted,
    purchaseInputs,
    purchases,
  };
}

test("an overlapping checkout cannot overwrite the active organization", async () => {
  const fixture = createFixture();
  const { purchases } = fixture;
  await purchases.identify({ userId: "user-1" });
  const first = purchases.purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  await fixture.checkoutStarted.promise;

  await expect(
    purchases.purchaseSync({
      organizationId: "org-2",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseIdentityPendingError);
  expect(fixture.attributes).toEqual({ orgId: "org-1" });
  expect(fixture.purchaseInputs).toHaveLength(1);

  fixture.checkout.resolve();
  await first;
});

test("organization binding waits for the active checkout", async () => {
  const fixture = createFixture();
  const { purchases } = fixture;
  await purchases.identify({ userId: "user-1" });
  const checkout = purchases.purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  await fixture.checkoutStarted.promise;

  const binding = purchases.bindOrganization({ organizationId: "org-2" });
  await Promise.resolve();
  expect(fixture.attributes).toEqual({ orgId: "org-1" });

  fixture.checkout.resolve();
  await Promise.all([checkout, binding]);
  expect(fixture.attributes).toEqual({ orgId: "org-2" });
});
