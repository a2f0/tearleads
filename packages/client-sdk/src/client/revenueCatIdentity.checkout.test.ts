import { expect, test } from "bun:test";
import type { RevenueCatBackend } from "./purchases";
import {
  createRevenueCatIdentityCoordinator,
  RevenueCatCheckoutAbandonedError,
  RevenueCatOperationTimeoutError,
} from "./revenueCatIdentity";

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
    async logIn(input) {
      calls.push(`login:${input.appUserId}`);
    },
    async logOut() {
      calls.push("logout");
    },
    async setAttributes() {},
    async getCurrentPackages() {
      return [];
    },
    async purchasePackage() {
      return { activeEntitlementIds: [] };
    },
    async getCustomerInfo() {
      return { activeEntitlementIds: [] };
    },
    async restorePurchases() {
      return { activeEntitlementIds: [] };
    },
  };
}

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function coordinator(backend: RevenueCatBackend, timeoutMs = 1_000) {
  return createRevenueCatIdentityCoordinator({
    apiKey: "key",
    backend,
    timeoutMs,
  });
}

test("checkout blocks identity changes but not provider reads", async () => {
  const backend = createBackend();
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const identity = coordinator(backend);
  await identity.identify("user-1");
  const purchasing = identity.runCheckout({
    operation: async () => {
      checkoutStarted.resolve();
      await checkout.promise;
      return "purchased";
    },
  });
  await checkoutStarted.promise;

  await identity.identify("user-1");
  const read = identity.runProviderOperation({
    operation: async () => "read",
    operationName: "test read",
  });
  const identifying = identity.identify("user-2");
  let laterReadStarted = false;
  const laterRead = identity.runProviderOperation({
    operation: async () => {
      laterReadStarted = true;
    },
    operationName: "later read",
  });
  expect(await read).toBe("read");
  await Promise.resolve();
  expect(backend.calls).toEqual(["configure:user-1"]);
  expect(laterReadStarted).toBe(false);

  checkout.resolve();
  expect(await purchasing).toBe("purchased");
  await Promise.all([identifying, laterRead]);
  expect(backend.calls).toEqual(["configure:user-1", "login:user-2"]);
  expect(laterReadStarted).toBe(true);
});

test("a hung checkout makes a waiting identity timeout terminal", async () => {
  const backend = createBackend();
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const identity = coordinator(backend, 5);
  await identity.identify("user-1");
  const purchasing = identity.runCheckout({
    operation: async () => {
      checkoutStarted.resolve();
      await checkout.promise;
    },
  });
  await checkoutStarted.promise;

  const identifying = identity.identify("user-2");
  await expect(identifying).rejects.toMatchObject({ restartRequired: true });
  const customerRead = identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "customer read",
  });
  await expect(customerRead).rejects.toBeInstanceOf(
    RevenueCatOperationTimeoutError,
  );
  await expect(customerRead).rejects.toMatchObject({ restartRequired: true });

  checkout.resolve();
  await purchasing;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "settled read",
  });
});

test("a failed checkout releases its identity gate", async () => {
  const backend = createBackend();
  const identity = coordinator(backend);
  await identity.identify("user-1");

  const purchasing = identity.runCheckout({
    operation: async () => {
      throw new Error("purchase failed");
    },
  });
  const identifying = identity.identify("user-2");

  await expect(purchasing).rejects.toThrow("purchase failed");
  await identifying;
  expect(backend.calls).toEqual(["configure:user-1", "login:user-2"]);
});

test("an aborted checkout releases its identity gate", async () => {
  const backend = createBackend();
  const checkoutStarted = createDeferred();
  const abortController = new AbortController();
  const identity = coordinator(backend);
  await identity.identify("user-1");
  void identity.runCheckout({
    abortSignal: abortController.signal,
    operation: () => {
      checkoutStarted.resolve();
      return new Promise<void>(() => {});
    },
  });
  await checkoutStarted.promise;

  const identifying = identity.identify("user-2");
  abortController.abort();
  await identifying;
  expect(backend.calls).toEqual(["configure:user-1", "login:user-2"]);
});

test("abort before checkout registration skips preparation and mounting", async () => {
  const backend = createBackend();
  const blocker = createDeferred();
  const blockerStarted = createDeferred();
  const abortController = new AbortController();
  const identity = coordinator(backend);
  await identity.identify("user-1");
  const blocking = identity.runProviderOperation({
    operation: async () => {
      blockerStarted.resolve();
      await blocker.promise;
    },
    operationName: "blocker",
  });
  await blockerStarted.promise;
  let checkoutStarts = 0;
  let preparationStarts = 0;
  const purchasing = identity.runCheckout({
    abortSignal: abortController.signal,
    operation: async () => {
      checkoutStarts += 1;
    },
    prepare: async () => {
      preparationStarts += 1;
    },
  });
  const identifying = identity.identify("user-2");
  abortController.abort();
  blocker.resolve();
  await blocking;
  await expect(purchasing).rejects.toBeInstanceOf(
    RevenueCatCheckoutAbandonedError,
  );
  await identifying;
  expect(checkoutStarts).toBe(0);
  expect(preparationStarts).toBe(0);
});

test("a provider timeout prevents an orphan checkout sheet", async () => {
  const backend = createBackend();
  const blocker = createDeferred();
  const blockerStarted = createDeferred();
  const identity = coordinator(backend, 5);
  await identity.identify("user-1");
  const blocking = identity.runProviderOperation({
    operation: async () => {
      blockerStarted.resolve();
      await blocker.promise;
    },
    operationName: "blocker",
  });
  await blockerStarted.promise;
  await expect(blocking).rejects.toThrow(
    "RevenueCat blocker timed out after 5ms",
  );

  let checkoutStarts = 0;
  await expect(
    identity.runCheckout({
      operation: async () => {
        checkoutStarts += 1;
      },
    }),
  ).rejects.toThrow("RevenueCat blocker timed out after 5ms");
  blocker.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "settlement",
    requiresKnownIdentity: false,
  });
  expect(checkoutStarts).toBe(0);
});
