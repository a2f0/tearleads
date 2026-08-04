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

test("a checkout timeout rejects an already-queued restore", async () => {
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
  let restoreStarts = 0;
  const restoreError = identity
    .runProviderOperation({
      operation: async () => {
        restoreStarts += 1;
      },
      operationName: "restore",
      waitForCheckout: true,
    })
    .then(
      () => null,
      (error: unknown) => error,
    );

  await expect(purchasing).rejects.toMatchObject({
    operationName: "checkout settlement",
    restartRequired: true,
  });
  expect(await restoreError).toMatchObject({
    operationName: "checkout settlement",
    restartRequired: true,
  });
  expect(restoreStarts).toBe(0);

  checkout.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await identity.runProviderOperation({
    operation: async () => {
      restoreStarts += 1;
    },
    operationName: "restore retry",
    waitForCheckout: true,
  });
  expect(restoreStarts).toBe(1);
});

test("a customer read keeps its FIFO position between identities", async () => {
  const backend = createBackend();
  const login = createDeferred();
  const loginStarted = createDeferred();
  backend.logIn = async ({ appUserId }) => {
    backend.calls.push(`login:${appUserId}`);
    if (appUserId === "user-2") {
      loginStarted.resolve();
      await login.promise;
    }
  };
  const identity = createRevenueCatIdentityCoordinator({
    apiKey: "key",
    backend,
    checkoutSettlementTimeoutMs: 1_000,
    timeoutMs: 1_000,
  });
  await identity.identify("user-1");
  const firstIdentity = identity.identify("user-2");
  await loginStarted.promise;
  const read = identity.runProviderOperation({
    operation: async () => {
      backend.calls.push("read");
    },
    operationName: "customer read",
  });
  const laterIdentity = identity.identify("user-3");

  login.resolve();
  await Promise.all([firstIdentity, read, laterIdentity]);
  expect(backend.calls).toEqual([
    "configure:user-1",
    "login:user-2",
    "read",
    "login:user-3",
  ]);
});
