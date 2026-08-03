import { expect, test } from "bun:test";
import type { RevenueCatBackend } from "./purchases";
import { createRevenueCatIdentityCoordinator } from "./revenueCatIdentity";

interface RecordingBackend extends RevenueCatBackend {
  readonly calls: string[];
}

function createBackend(): RecordingBackend {
  const calls: string[] = [];
  return {
    calls,
    async configure(input) {
      calls.push(`configure:${input.appUserId ?? "anonymous"}`);
    },
    async getCurrentPackages() {
      return [];
    },
    async getCustomerInfo() {
      return { activeEntitlementIds: [] };
    },
    async logIn(input) {
      calls.push(`login:${input.appUserId}`);
    },
    async logOut() {},
    async purchasePackage() {
      return { activeEntitlementIds: [] };
    },
    async restorePurchases() {
      return { activeEntitlementIds: [] };
    },
    async setAttributes() {},
  };
}

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("a checkout timeout rejects an already-queued identity change", async () => {
  const backend = createBackend();
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const identity = createRevenueCatIdentityCoordinator({
    apiKey: "key",
    backend,
    checkoutSettlementTimeoutMs: 5,
    timeoutMs: 1_000,
  });
  await identity.identify("user-1");
  const purchasing = identity.runCheckout({
    operation: async () => {
      checkoutStarted.resolve();
      await checkout.promise;
    },
  });
  await checkoutStarted.promise;

  const queuedIdentityError = identity.identify("user-2").then(
    () => null,
    (error: unknown) => error,
  );
  await expect(purchasing).rejects.toMatchObject({
    operationName: "checkout settlement",
    restartRequired: true,
  });
  expect(await queuedIdentityError).toMatchObject({
    operationName: "checkout settlement",
    restartRequired: true,
  });
  expect(backend.calls).toEqual(["configure:user-1"]);

  checkout.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await identity.identify("user-2");
  expect(backend.calls).toEqual(["configure:user-1", "login:user-2"]);
});
