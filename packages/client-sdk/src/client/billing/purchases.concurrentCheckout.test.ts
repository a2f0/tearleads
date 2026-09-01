import { expect, test } from "bun:test";
import { createDeferred } from "../../../test/helpers/revenueCatFakes";
import {
  createRevenueCatPurchases,
  PurchaseIdentityPendingError,
  type RevenueCatBackend,
  type RevenueCatCustomerInfo,
} from "./purchases";

function createFixture() {
  const attributes: Record<string, string | null> = {};
  const calls: string[] = [];
  const purchaseInputs: Array<{ packageId: string }> = [];
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const emptyInfo: RevenueCatCustomerInfo = { activeEntitlementIds: [] };
  const backend: RevenueCatBackend = {
    configure: async () => {
      calls.push("configure");
    },
    logIn: async ({ appUserId }) => {
      calls.push(`logIn:${appUserId}`);
    },
    logOut: async () => {},
    setAttributes: async (next) => {
      Object.assign(attributes, next);
      const { orgId } = next;
      calls.push(`setAttributes:${String(orgId)}`);
    },
    getCurrentPackages: async () => [],
    purchasePackage: async (input) => {
      purchaseInputs.push(input);
      checkoutStarted.resolve();
      await checkout.promise;
      return { activeEntitlementIds: ["sync"] };
    },
    getCustomerInfo: async () => emptyInfo,
    restorePurchases: async () => {
      calls.push("restorePurchases");
      return { activeEntitlementIds: ["sync"] };
    },
  };
  const purchases = createRevenueCatPurchases(backend, {
    apiKey: "key",
    nativeStore: "test_store",
    restorePurchasesUsesCheckoutTimeout: false,
    syncEntitlementId: "sync",
  });
  return {
    attributes,
    calls,
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

test("organization binding stays ahead of a later identity change", async () => {
  const fixture = createFixture();
  const { purchases } = fixture;
  await purchases.identify({ userId: "user-1" });
  const checkout = purchases.purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  await fixture.checkoutStarted.promise;

  const binding = purchases.bindOrganization({ organizationId: "org-2" });
  const identifying = purchases.identify({ userId: "user-2" });
  fixture.checkout.resolve();
  await Promise.all([checkout, binding, identifying]);

  expect(fixture.calls.indexOf("setAttributes:org-2")).toBeLessThan(
    fixture.calls.indexOf("logIn:user-2"),
  );
});

test("native move holds its buyer through claim and binding", async () => {
  const fixture = createFixture();
  const claim = createDeferred();
  const claimStarted = createDeferred();
  await fixture.purchases.identify({ userId: "user-1" });

  const moving = fixture.purchases.moveNativeSubscription({
    claim: async () => {
      fixture.calls.push("claim");
      claimStarted.resolve();
      await claim.promise;
      return true;
    },
    prepareClaim: async () => "org-1",
    userId: "user-1",
  });
  await claimStarted.promise;
  const identifying = fixture.purchases.identify({ userId: "user-2" });
  await Promise.resolve();
  expect(fixture.calls).not.toContain("logIn:user-2");

  claim.resolve();
  await Promise.all([moving, identifying]);
  expect(fixture.calls.indexOf("claim")).toBeLessThan(
    fixture.calls.indexOf("setAttributes:org-1"),
  );
  expect(fixture.calls.indexOf("setAttributes:org-1")).toBeLessThan(
    fixture.calls.indexOf("logIn:user-2"),
  );
});
