import { expect, test } from "bun:test";
import {
  createCoordinator as coordinator,
  createRecordingBackend as createBackend,
  createDeferred,
} from "../../../test/helpers/revenueCatFakes";

test("a checkout timeout rejects an already-queued identity change", async () => {
  const backend = createBackend();
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  const identity = coordinator(backend, 1_000, 5);
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
  const identity = coordinator(backend, 1_000, 5);
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
  const identity = coordinator(backend);
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
