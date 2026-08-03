import { expect, test } from "bun:test";
import {
  createRevenueCatPurchases,
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type RevenueCatBackend,
} from "./purchases";

function createBackend(): RevenueCatBackend {
  return {
    async configure() {},
    async logIn() {},
    async logOut() {},
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

function purchases(backend: RevenueCatBackend) {
  return createRevenueCatPurchases(backend, {
    apiKey: "key",
    nativeStore: "test_store",
    operationTimeoutMs: 50,
    syncEntitlementId: "sync",
  });
}

test("offerings expose a terminal error when the provider stalls", async () => {
  const backend = createBackend();
  backend.getCurrentPackages = () => new Promise(() => {});

  await expect(purchases(backend).listSyncOptions()).rejects.toBeInstanceOf(
    PurchaseProviderStalledError,
  );
});

test("reset exposes a terminal error when logout stalls", async () => {
  const backend = createBackend();
  backend.logOut = () => new Promise(() => {});

  await expect(purchases(backend).reset()).rejects.toBeInstanceOf(
    PurchaseProviderStalledError,
  );
});

test("checkout preparation exposes a terminal provider timeout", async () => {
  const backend = createBackend();
  backend.setAttributes = () => new Promise(() => {});

  await expect(
    purchases(backend).purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
});

test("checkout waiting on configuration stays retryable", async () => {
  const backend = createBackend();
  backend.configure = () => new Promise(() => {});

  await expect(
    purchases(backend).purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseIdentityPendingError);
});

test("organization binding exposes a terminal provider timeout", async () => {
  const backend = createBackend();
  backend.setAttributes = () => new Promise(() => {});

  await expect(
    purchases(backend).bindOrganization({ organizationId: "org-1" }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
});

test("restore stays buyer-paced beyond the ordinary provider deadline", async () => {
  const backend = createBackend();
  let finishRestore = () => {};
  let markRestoreStarted = () => {};
  const restoreStarted = new Promise<void>((resolve) => {
    markRestoreStarted = resolve;
  });
  const restoreReady = new Promise<void>((resolve) => {
    finishRestore = resolve;
  });
  backend.restorePurchases = async () => {
    markRestoreStarted();
    await restoreReady;
    return { activeEntitlementIds: ["sync"] };
  };
  const capability = purchases(backend);
  let settled = false;
  const restoring = capability.restore().then(() => {
    settled = true;
  });

  await restoreStarted;
  await expect(capability.hasActiveSyncEntitlement()).rejects.toBeInstanceOf(
    PurchaseProviderStalledError,
  );
  expect(settled).toBe(false);
  finishRestore();
  await restoring;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await capability.hasActiveSyncEntitlement()).toBe(false);
});

test("restore bounds identity settlement before opening store UI", async () => {
  const backend = createBackend();
  let restoreStarts = 0;
  backend.logIn = () => new Promise(() => {});
  backend.restorePurchases = async () => {
    restoreStarts += 1;
    return { activeEntitlementIds: ["sync"] };
  };
  const capability = purchases(backend);
  await capability.listSyncOptions();
  const identifying = capability
    .identify({ userId: "user-1" })
    .catch((error: unknown) => error);
  const restoring = capability.restore().catch((error: unknown) => error);

  const [identifyError, restoreError] = await Promise.all([
    identifying,
    restoring,
  ]);
  expect(identifyError).toBeInstanceOf(PurchaseProviderStalledError);
  expect(restoreError).toBeInstanceOf(PurchaseProviderStalledError);
  expect(restoreStarts).toBe(0);
});

test("restore bounds stalled configuration before opening store UI", async () => {
  const backend = createBackend();
  let restoreStarts = 0;
  backend.configure = () => new Promise(() => {});
  backend.restorePurchases = async () => {
    restoreStarts += 1;
    return { activeEntitlementIds: ["sync"] };
  };

  await expect(purchases(backend).restore()).rejects.toBeInstanceOf(
    PurchaseProviderStalledError,
  );
  expect(restoreStarts).toBe(0);
});

test("plain configuration errors retain bounded diagnostics", async () => {
  const backend = createBackend();
  const providerError = { code: "2", message: "Configuration failed" };
  backend.configure = () => Promise.reject(providerError);

  const error = await purchases(backend)
    .identify({ userId: "user-1" })
    .then(
      () => null,
      (rejection: unknown) => rejection,
    );
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject(providerError);
  expect((error as Error).cause).toBe(providerError);
});
