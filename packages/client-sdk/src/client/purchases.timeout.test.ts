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

function purchases(
  backend: RevenueCatBackend,
  nativeStore: "app_store" | "play_store" | "test_store" = "play_store",
  restorePurchasesBuyerPaced = nativeStore === "app_store",
) {
  return createRevenueCatPurchases(backend, {
    apiKey: "key",
    nativeStore,
    operationTimeoutMs: 50,
    restorePurchasesBuyerPaced,
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

test("checkout bounds provider package resolution before the store sheet", async () => {
  const backend = createBackend();
  let purchaseStarts = 0;
  backend.preparePurchasePackage = () => new Promise(() => {});
  backend.purchasePackage = async () => {
    purchaseStarts += 1;
    return { activeEntitlementIds: [] };
  };

  await expect(
    purchases(backend).purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
  expect(purchaseStarts).toBe(0);
});

test("checkout waiting on stalled configuration asks for restart", async () => {
  const backend = createBackend();
  backend.configure = () => new Promise(() => {});

  await expect(
    purchases(backend).purchaseSync({
      organizationId: "org-1",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
});

test("organization binding exposes a terminal provider timeout", async () => {
  const backend = createBackend();
  backend.setAttributes = () => new Promise(() => {});

  await expect(
    purchases(backend).bindOrganization({ organizationId: "org-1" }),
  ).rejects.toBeInstanceOf(PurchaseProviderStalledError);
});

test("iOS Test Store restore stays buyer-paced beyond the deadline", async () => {
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
  const capability = purchases(backend, "test_store", true);
  let settled = false;
  const restoring = capability.restore().then(() => {
    settled = true;
  });

  await restoreStarted;
  await expect(capability.hasActiveSyncEntitlement()).rejects.toBeInstanceOf(
    PurchaseIdentityPendingError,
  );
  expect(settled).toBe(false);
  finishRestore();
  await restoring;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await capability.hasActiveSyncEntitlement()).toBe(false);
});

test("Android restore exposes a terminal error when the bridge stalls", async () => {
  const backend = createBackend();
  backend.restorePurchases = () => new Promise(() => {});

  await expect(purchases(backend).restore()).rejects.toBeInstanceOf(
    PurchaseProviderStalledError,
  );
});

test("identity queued behind buyer-paced restore stays retryable", async () => {
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
  const capability = purchases(backend, "app_store");
  await capability.identify({ userId: "user-1" });
  const restoring = capability.restore();
  await restoreStarted;

  await expect(
    capability.identify({ userId: "user-2" }),
  ).rejects.toBeInstanceOf(PurchaseIdentityPendingError);
  finishRestore();
  await restoring;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await capability.identify({ userId: "user-2" });
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
