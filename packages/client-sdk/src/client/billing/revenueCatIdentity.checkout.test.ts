import { expect, test } from "bun:test";
import {
  createCoordinator as coordinator,
  createRecordingBackend as createBackend,
  createDeferred,
} from "../../../test/helpers/revenueCatFakes";
import {
  RevenueCatCheckoutAbandonedError,
  RevenueCatCheckoutIdentityPendingError,
  RevenueCatOperationTimeoutError,
} from "./revenueCatErrors";

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

test("a restore waits only for identity changes pending at reservation", async () => {
  const backend = createBackend();
  const firstLogin = createDeferred();
  const firstLoginStarted = createDeferred();
  const restore = createDeferred();
  const restoreStarted = createDeferred();
  backend.logIn = async ({ appUserId }) => {
    backend.calls.push(`login:${appUserId}`);
    if (appUserId === "user-2") {
      firstLoginStarted.resolve();
      await firstLogin.promise;
    }
  };
  const identity = coordinator(backend);
  await identity.identify("user-1");
  const firstIdentity = identity.identify("user-2");
  await firstLoginStarted.promise;

  const restoring = identity.runProviderOperation({
    usesCheckoutSettlementTimeout: true,
    operation: async () => {
      backend.calls.push("restore");
      restoreStarted.resolve();
      await restore.promise;
    },
    operationName: "restore",
    waitForCheckout: true,
  });
  const laterIdentity = identity.identify("user-3");
  firstLogin.resolve();

  await restoreStarted.promise;
  expect(backend.calls).toEqual([
    "configure:user-1",
    "login:user-2",
    "restore",
  ]);
  restore.resolve();
  await Promise.all([firstIdentity, restoring, laterIdentity]);
  expect(backend.calls).toEqual([
    "configure:user-1",
    "login:user-2",
    "restore",
    "login:user-3",
  ]);
});

test("a buyer-paced checkout keeps a waiting identity retryable", async () => {
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
  await expect(identifying).rejects.toMatchObject({ restartRequired: false });
  const customerRead = identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "customer read",
  });
  await expect(customerRead).rejects.toBeInstanceOf(
    RevenueCatOperationTimeoutError,
  );
  await expect(customerRead).rejects.toMatchObject({ restartRequired: false });

  checkout.resolve();
  await purchasing;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "settled read",
  });
});

test("a late identity mutation stall promotes restart guidance", async () => {
  const backend = createBackend();
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const login = createDeferred();
  const loginStarted = createDeferred();
  backend.logIn = async () => {
    loginStarted.resolve();
    await login.promise;
  };
  const identity = coordinator(backend, 5);
  await identity.identify("user-1");
  const purchasing = identity.runCheckout({
    operation: async () => {
      checkoutStarted.resolve();
      await checkout.promise;
    },
  });
  await checkoutStarted.promise;

  await expect(identity.identify("user-2")).rejects.toMatchObject({
    restartRequired: false,
  });
  checkout.resolve();
  await purchasing;
  await loginStarted.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const stalledRead = identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "stalled read",
  });
  await expect(stalledRead).rejects.toMatchObject({ restartRequired: true });

  login.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "settled read",
  });
});

test("a queued provider stall eventually promotes restart guidance", async () => {
  const backend = createBackend();
  const restore = createDeferred();
  const restoreStarted = createDeferred();
  const read = createDeferred();
  const readStarted = createDeferred();
  const identity = coordinator(backend, 5);
  await identity.identify("user-1");
  const restoring = identity.runProviderOperation({
    usesCheckoutSettlementTimeout: true,
    operation: async () => {
      restoreStarted.resolve();
      await restore.promise;
    },
    operationName: "restore",
  });
  await restoreStarted.promise;
  const queuedRead = identity.runProviderOperation({
    operation: async () => {
      readStarted.resolve();
      await read.promise;
    },
    operationName: "queued read",
  });

  await expect(queuedRead).rejects.toMatchObject({ restartRequired: false });
  restore.resolve();
  await restoring;
  await readStarted.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const stalledRead = identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "stalled read",
  });
  await expect(stalledRead).rejects.toMatchObject({ restartRequired: true });

  read.resolve();
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

test("abort wins over a pending configuration failure", async () => {
  const backend = createBackend();
  const configuration = createDeferred();
  const configurationStarted = createDeferred();
  backend.configure = async () => {
    configurationStarted.resolve();
    await configuration.promise;
  };
  const abortController = new AbortController();
  const identity = coordinator(backend);
  const purchasing = identity.runCheckout({
    abortSignal: abortController.signal,
    operation: async () => undefined,
  });
  await configurationStarted.promise;

  abortController.abort();
  configuration.reject(new Error("configuration failed"));

  await expect(purchasing).rejects.toBeInstanceOf(
    RevenueCatCheckoutAbandonedError,
  );
});

test("native abort keeps identity gated until the store settles", async () => {
  const backend = createBackend();
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const abortController = new AbortController();
  const identity = coordinator(backend);
  await identity.identify("user-1");
  const purchasing = identity.runCheckout({
    abortSignal: abortController.signal,
    operation: async () => {
      checkoutStarted.resolve();
      await checkout.promise;
    },
  });
  await checkoutStarted.promise;

  const identifying = identity.identify("user-2");
  abortController.abort();
  await Promise.resolve();
  expect(backend.calls).toEqual(["configure:user-1"]);

  checkout.resolve();
  await Promise.all([purchasing, identifying]);
  expect(backend.calls).toEqual(["configure:user-1", "login:user-2"]);
});

test("a second checkout waits until the active store sheet settles", async () => {
  const backend = createBackend();
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const identity = coordinator(backend);
  await identity.identify("user-1");
  const first = identity.runCheckout({
    operation: async () => {
      checkoutStarted.resolve();
      await checkout.promise;
    },
  });
  await checkoutStarted.promise;
  let secondStarts = 0;

  await expect(
    identity.runCheckout({
      operation: async () => {
        secondStarts += 1;
      },
    }),
  ).rejects.toBeInstanceOf(RevenueCatCheckoutIdentityPendingError);
  expect(secondStarts).toBe(0);

  checkout.resolve();
  await first;
  await identity.runCheckout({
    operation: async () => {
      secondStarts += 1;
    },
  });
  expect(secondStarts).toBe(1);
});

test("a lost checkout callback eventually requires restart", async () => {
  const backend = createBackend();
  const identity = coordinator(backend, 1_000, 5);
  await identity.identify("user-1");

  const error = await identity
    .runCheckout({ operation: () => new Promise<void>(() => {}) })
    .then(
      () => null,
      (rejection: unknown) => rejection,
    );
  expect(error).toBeInstanceOf(RevenueCatOperationTimeoutError);
  expect(error).toMatchObject({
    operationName: "checkout settlement",
    restartRequired: true,
  });
  await expect(identity.identify("user-2")).rejects.toMatchObject({
    operationName: "checkout settlement",
    restartRequired: true,
  });
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
