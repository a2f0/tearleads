import { expect, test } from "bun:test";
import type { RevenueCatBackend } from "./purchases";
import {
  createRevenueCatIdentityCoordinator,
  revenueCatOperationTimeoutMs,
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

function configureAnonymously(identity: ReturnType<typeof coordinator>) {
  return identity.runProviderOperation({
    operation: async () => undefined,
    operationName: "test setup",
    requiresKnownIdentity: false,
  });
}

test("initial configuration establishes the requested identity", async () => {
  const backend = createBackend();

  await coordinator(backend).identify("user-1");

  expect(backend.calls).toEqual(["configure:user-1"]);
});

test("identification logs in after anonymous configuration", async () => {
  const backend = createBackend();
  const identity = coordinator(backend);

  await configureAnonymously(identity);
  await identity.identify("user-1");

  expect(backend.calls).toEqual(["configure:anonymous", "login:user-1"]);
});

test("concurrent same-user identification shares one login", async () => {
  const backend = createBackend();
  const login = createDeferred();
  const loginStarted = createDeferred();
  backend.logIn = async (input) => {
    backend.calls.push(`login:${input.appUserId}`);
    loginStarted.resolve();
    await login.promise;
  };
  const identity = coordinator(backend);
  await configureAnonymously(identity);

  const first = identity.identify("user-1");
  const second = identity.identify("user-1");
  await loginStarted.promise;
  expect(backend.calls).toEqual(["configure:anonymous", "login:user-1"]);

  login.resolve();
  await Promise.all([first, second]);
  expect(backend.calls).toEqual(["configure:anonymous", "login:user-1"]);
});

test("different-user identity transitions do not overlap", async () => {
  const backend = createBackend();
  const firstLogin = createDeferred();
  const secondLogin = createDeferred();
  const firstStarted = createDeferred();
  const secondStarted = createDeferred();
  backend.logIn = async (input) => {
    backend.calls.push(`login:${input.appUserId}`);
    if (input.appUserId === "user-1") {
      firstStarted.resolve();
      await firstLogin.promise;
      return;
    }
    secondStarted.resolve();
    await secondLogin.promise;
  };
  const identity = coordinator(backend);
  await configureAnonymously(identity);

  const first = identity.identify("user-1");
  const second = identity.identify("user-2");
  await firstStarted.promise;
  expect(backend.calls).toEqual(["configure:anonymous", "login:user-1"]);

  firstLogin.resolve();
  await secondStarted.promise;
  expect(backend.calls).toEqual([
    "configure:anonymous",
    "login:user-1",
    "login:user-2",
  ]);
  secondLogin.resolve();
  await Promise.all([first, second]);
});

test("a delayed identity recovery clears its timeout wedge", async () => {
  const backend = createBackend();
  const recovery = createDeferred();
  const readRan = createDeferred();
  let attempts = 0;
  backend.logIn = async (input) => {
    attempts += 1;
    backend.calls.push(`login:${input.appUserId}`);
    if (attempts === 1) throw new Error("login failed");
    await recovery.promise;
  };
  const identity = coordinator(backend, 5);
  await configureAnonymously(identity);

  await expect(identity.identify("user-1")).rejects.toThrow("login failed");
  let reads = 0;
  const read = identity.runProviderOperation({
    operation: async () => {
      reads += 1;
      readRan.resolve();
    },
    operationName: "test read",
  });
  await expect(read).rejects.toThrow(
    "RevenueCat test read timed out after 5ms",
  );
  await expect(identity.identify("user-2")).rejects.toThrow(
    "RevenueCat test read timed out after 5ms",
  );
  recovery.resolve();
  await readRan.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await identity.identify("user-1");

  expect(attempts).toBe(2);
  expect(reads).toBe(1);
});

test("a permanent identity failure blocks customer reads until identify", async () => {
  const backend = createBackend();
  let attempts = 0;
  let allowLogin = false;
  backend.logIn = async () => {
    attempts += 1;
    if (!allowLogin) throw new Error("login denied");
  };
  const identity = coordinator(backend);
  await configureAnonymously(identity);

  await expect(identity.identify("user-1")).rejects.toThrow("login denied");
  const customerRead = () =>
    identity.runProviderOperation({
      operation: async () => "customer read",
      operationName: "customer read",
    });
  await expect(customerRead()).rejects.toThrow("login denied");
  await expect(customerRead()).rejects.toThrow("login denied");
  expect(attempts).toBe(2);

  const offeringRead = identity.runProviderOperation({
    operation: async () => "offering",
    operationName: "offering read",
    requiresKnownIdentity: false,
  });
  expect(await offeringRead).toBe("offering");

  allowLogin = true;
  await identity.identify("user-1");
  expect(await customerRead()).toBe("customer read");
  expect(attempts).toBe(3);
});

test("reset clears the identity before the same user returns", async () => {
  const backend = createBackend();
  const identity = coordinator(backend);

  await identity.identify("user-1");
  await identity.reset();
  await identity.identify("user-1");

  expect(backend.calls).toEqual(["configure:user-1", "logout", "login:user-1"]);
});

test("reset logs out an identity restored by bare configuration", async () => {
  const backend = createBackend();
  const identity = coordinator(backend);

  await configureAnonymously(identity);
  await identity.reset();

  expect(backend.calls).toEqual(["configure:anonymous", "logout"]);
});

test("identity settlement waits for a queued login", async () => {
  const backend = createBackend();
  const login = createDeferred();
  const loginStarted = createDeferred();
  backend.logIn = async (input) => {
    backend.calls.push(`login:${input.appUserId}`);
    loginStarted.resolve();
    await login.promise;
  };
  const identity = coordinator(backend);
  await configureAnonymously(identity);
  const identifying = identity.identify("user-1");
  await loginStarted.promise;

  let settled = false;
  const settling = identity
    .runProviderOperation({
      operation: async () => undefined,
      operationName: "test read",
    })
    .then(() => {
      settled = true;
    });
  await Promise.resolve();
  expect(settled).toBe(false);

  login.resolve();
  await Promise.all([identifying, settling]);
  expect(settled).toBe(true);
});

test("an identity change cannot overtake a provider operation", async () => {
  const backend = createBackend();
  const operation = createDeferred();
  const operationStarted = createDeferred();
  const identity = coordinator(backend);
  await identity.identify("user-1");
  const reading = identity.runProviderOperation({
    operation: async () => {
      operationStarted.resolve();
      await operation.promise;
    },
    operationName: "test read",
  });
  await operationStarted.promise;

  const identifying = identity.identify("user-2");
  await Promise.resolve();
  expect(backend.calls).toEqual(["configure:user-1"]);

  operation.resolve();
  await Promise.all([reading, identifying]);
  expect(backend.calls).toEqual(["configure:user-1", "login:user-2"]);
});

test("a configuration timeout never starts a second configure", async () => {
  const backend = createBackend();
  const configuration = createDeferred();
  backend.configure = async (input) => {
    backend.calls.push(`configure:${input.appUserId ?? "anonymous"}`);
    await configuration.promise;
  };
  const identity = coordinator(backend, 5);

  const configure = () =>
    identity.runProviderOperation({
      operation: async () => undefined,
      operationName: "configuration",
    });
  await expect(configure()).rejects.toThrow(
    "RevenueCat configuration timed out after 5ms",
  );
  await expect(configure()).rejects.toThrow(
    "RevenueCat configuration timed out after 5ms",
  );
  expect(backend.calls).toEqual(["configure:anonymous"]);

  configuration.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await configure();
  expect(backend.calls).toEqual(["configure:anonymous"]);
});

test("a stalled login times out without leaving the caller busy", async () => {
  const backend = createBackend();
  backend.logIn = () => new Promise(() => {});
  const identity = coordinator(backend, 5);
  await configureAnonymously(identity);

  await expect(identity.identify("user-1")).rejects.toThrow(
    "RevenueCat identification timed out after 5ms",
  );
  let readStarted = false;
  const read = identity.runProviderOperation({
    operation: async () => {
      readStarted = true;
    },
    operationName: "customer read",
  });
  let readRejected = false;
  void read.catch(() => {
    readRejected = true;
  });
  await Promise.resolve();
  expect(readRejected).toBe(true);
  expect(readStarted).toBe(false);
  await expect(read).rejects.toThrow(
    "RevenueCat identification timed out after 5ms",
  );
  await expect(identity.identify("user-2")).rejects.toThrow(
    "RevenueCat identification timed out after 5ms",
  );
});

test("a stalled logout times out without leaving the caller busy", async () => {
  const backend = createBackend();
  backend.logOut = () => new Promise(() => {});
  const identity = coordinator(backend, 5);
  await identity.identify("user-1");

  await expect(identity.reset()).rejects.toThrow(
    "RevenueCat reset timed out after 5ms",
  );
});

test.each([
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
])("rejects an invalid operation timeout: %s", (timeoutMs) => {
  expect(() => revenueCatOperationTimeoutMs(timeoutMs)).toThrow(
    "RevenueCat operation timeout must be a positive finite number",
  );
});
