import { expect, test } from "bun:test";
import {
  createRevenueCatPurchases,
  createUnavailablePurchases,
  PurchaseCancelledError,
  PurchasesUnavailableError,
  type RevenueCatBackend,
  type RevenueCatCustomerInfo,
  type RevenueCatPackage,
} from "./purchases";

interface RecordingBackend extends RevenueCatBackend {
  readonly calls: string[];
  readonly configureAppUserIds: Array<string | undefined>;
  readonly attributes: Record<string, string | null>;
  readonly purchaseInputs: Array<{
    packageId: string;
    htmlTarget?: HTMLElement;
    metadata?: Record<string, string>;
    abortSignal?: AbortSignal;
  }>;
}

function createFakeBackend(options?: {
  packages?: RevenueCatPackage[];
  entitlementsAfterPurchase?: string[];
  entitlementsNow?: string[];
}): RecordingBackend {
  const calls: string[] = [];
  const configureAppUserIds: Array<string | undefined> = [];
  const attributes: Record<string, string | null> = {};
  const purchaseInputs: RecordingBackend["purchaseInputs"][number][] = [];
  const purchaseInfo: RevenueCatCustomerInfo = {
    activeEntitlementIds: options?.entitlementsAfterPurchase ?? ["sync"],
  };
  const currentInfo: RevenueCatCustomerInfo = {
    activeEntitlementIds: options?.entitlementsNow ?? [],
  };
  return {
    calls,
    configureAppUserIds,
    attributes,
    purchaseInputs,
    async configure(input) {
      calls.push("configure");
      configureAppUserIds.push(input.appUserId);
    },
    async logIn(input) {
      calls.push(`logIn:${input.appUserId}`);
    },
    async logOut() {
      calls.push("logOut");
    },
    async setAttributes(next) {
      calls.push("setAttributes");
      Object.assign(attributes, next);
    },
    async getCurrentPackages() {
      calls.push("getCurrentPackages");
      return options?.packages ?? [];
    },
    async purchasePackage(input) {
      calls.push(`purchasePackage:${input.packageId}`);
      purchaseInputs.push(input);
      return purchaseInfo;
    },
    async getCustomerInfo() {
      calls.push("getCustomerInfo");
      return currentInfo;
    },
    async restorePurchases() {
      calls.push("restorePurchases");
      return currentInfo;
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

const CONFIG = {
  apiKey: "key",
  nativeStore: "test_store" as const,
  syncEntitlementId: "sync",
};

test("configures the backend lazily and only once", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  expect(backend.calls).toHaveLength(0); // no configure on construction

  await purchases.identify({ userId: "user-1" });
  await purchases.hasActiveSyncEntitlement();

  expect(backend.calls.filter((call) => call === "configure")).toHaveLength(1);
});

test("retries configuration after a failed attempt instead of caching the rejection", async () => {
  const backend = createFakeBackend();
  let shouldFail = true;
  backend.configure = () => {
    backend.calls.push("configure");
    if (shouldFail) {
      shouldFail = false;
      return Promise.reject(new Error("Transient configuration error"));
    }
    return Promise.resolve();
  };
  const purchases = createRevenueCatPurchases(backend, CONFIG);

  // Await the first rejection so `configured` is cleared before the retry.
  await expect(purchases.identify({ userId: "user-1" })).rejects.toThrow(
    "Transient configuration error",
  );
  // A second call retries configure (rather than replaying the cached failure)
  // and then succeeds; a third call reuses the now-cached success.
  await purchases.identify({ userId: "user-1" });
  await purchases.identify({ userId: "user-1" });
  expect(backend.calls.filter((call) => call === "configure")).toHaveLength(2);
});

test("identify configures directly onto the first app user id", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  await purchases.identify({ userId: "user-42" });
  expect(backend.configureAppUserIds).toEqual(["user-42"]);
  expect(backend.calls).not.toContain("logIn:user-42");
});

test("rejects an invalid provider operation timeout at construction", () => {
  expect(() =>
    createRevenueCatPurchases(createFakeBackend(), {
      ...CONFIG,
      operationTimeoutMs: 0,
    }),
  ).toThrow("RevenueCat operation timeout must be positive");
});

test("listSyncOptions maps provider packages to display options", async () => {
  const backend = createFakeBackend({
    packages: [
      {
        identifier: "monthly",
        productIdentifier: "sync_monthly",
        title: "Sync",
        description: "Cloud sync",
        priceString: "$4.99",
      },
    ],
  });
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  const options = await purchases.listSyncOptions();
  expect(options).toEqual([
    {
      packageId: "monthly",
      productId: "sync_monthly",
      title: "Solo",
      description: "Cloud sync",
      priceLabel: "$4.99",
      tierId: "solo",
      seatLimit: 1,
    },
  ]);
});

test("purchaseSync binds the org attribute before buying and reports the entitlement", async () => {
  const backend = createFakeBackend({ entitlementsAfterPurchase: ["sync"] });
  const purchases = createRevenueCatPurchases(backend, CONFIG);

  const result = await purchases.purchaseSync({
    organizationId: "org-9",
    packageId: "monthly",
  });

  expect(result.syncEntitlementActive).toBe(true);
  expect(backend.attributes).toEqual({ orgId: "org-9" });
  // The org attribute must be set before the purchase call.
  expect(backend.calls.indexOf("setAttributes")).toBeLessThan(
    backend.calls.indexOf("purchasePackage:monthly"),
  );
});

test("purchaseSync forwards the checkout host and abort signal to the backend", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  const checkoutHost = { id: "checkout-host" } as unknown as HTMLElement;
  const abortSignal = new AbortController().signal;

  await purchases.purchaseSync({
    organizationId: "org-9",
    packageId: "monthly",
    checkoutHost,
    abortSignal,
  });
  await purchases.purchaseSync({
    organizationId: "org-9",
    packageId: "monthly",
  });

  expect(backend.purchaseInputs[0]?.htmlTarget).toBe(checkoutHost);
  expect(backend.purchaseInputs[0]?.abortSignal).toBe(abortSignal);
  expect(backend.purchaseInputs[1]?.htmlTarget).toBeUndefined();
  expect(backend.purchaseInputs[1]?.abortSignal).toBeUndefined();
});

test("a live checkout delays identity changes but not entitlement reads", async () => {
  const backend = createFakeBackend({ entitlementsNow: ["sync"] });
  const checkout = createDeferred();
  const checkoutStarted = createDeferred();
  backend.purchasePackage = async (input) => {
    backend.calls.push(`purchasePackage:${input.packageId}`);
    checkoutStarted.resolve();
    await checkout.promise;
    return { activeEntitlementIds: ["sync"] };
  };
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  await purchases.identify({ userId: "user-1" });
  const purchasing = purchases.purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  await checkoutStarted.promise;

  expect(await purchases.hasActiveSyncEntitlement()).toBe(true);
  const identifying = purchases.identify({ userId: "user-2" });
  await Promise.resolve();
  expect(backend.calls).not.toContain("logIn:user-2");

  checkout.resolve();
  await Promise.all([purchasing, identifying]);
  expect(backend.calls).toContain("logIn:user-2");
});

test("purchaseSync normalizes post-abort preparation failures to cancellation", async () => {
  const failing: RevenueCatBackend = {
    ...createFakeBackend(),
    async setAttributes() {
      throw new Error("network down");
    },
  };
  const purchases = createRevenueCatPurchases(failing, CONFIG);
  const aborted = new AbortController();
  aborted.abort();

  // Abandoned flow: the preparation failure is not a real outcome.
  expect(
    purchases.purchaseSync({
      organizationId: "org-9",
      packageId: "monthly",
      abortSignal: aborted.signal,
    }),
  ).rejects.toBeInstanceOf(PurchaseCancelledError);

  // Live flow: the real error must surface.
  expect(
    purchases.purchaseSync({
      organizationId: "org-9",
      packageId: "monthly",
      abortSignal: new AbortController().signal,
    }),
  ).rejects.toThrow("network down");
});

test("purchaseSync stamps the org onto the transaction metadata", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, CONFIG);

  await purchases.purchaseSync({
    organizationId: "org-9",
    packageId: "monthly",
  });

  // The metadata mirrors the subscriber attribute but is per-transaction and
  // immutable, so a purchase that completes late is still attributed to the
  // org it was started for.
  expect(backend.purchaseInputs[0]?.metadata).toEqual({ orgId: "org-9" });
});

test("purchaseSync honors a custom attribute key in the metadata too", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, {
    ...CONFIG,
    organizationAttributeKey: "$organizationId",
  });

  await purchases.purchaseSync({ organizationId: "org-1", packageId: "p" });

  expect(backend.purchaseInputs[0]?.metadata).toEqual({
    $organizationId: "org-1",
  });
});

test("purchaseSync reports an inactive entitlement when the purchase grants none", async () => {
  const backend = createFakeBackend({ entitlementsAfterPurchase: [] });
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  const result = await purchases.purchaseSync({
    organizationId: "org-9",
    packageId: "monthly",
  });
  expect(result.syncEntitlementActive).toBe(false);
});

test("purchaseSync honors a custom organization attribute key", async () => {
  const backend = createFakeBackend();
  const purchases = createRevenueCatPurchases(backend, {
    ...CONFIG,
    organizationAttributeKey: "$organizationId",
  });
  await purchases.purchaseSync({ organizationId: "org-1", packageId: "p" });
  expect(backend.attributes).toEqual({ $organizationId: "org-1" });
});

test("hasActiveSyncEntitlement reflects the current customer entitlements", async () => {
  const withSync = createRevenueCatPurchases(
    createFakeBackend({ entitlementsNow: ["sync"] }),
    CONFIG,
  );
  const withoutSync = createRevenueCatPurchases(
    createFakeBackend({ entitlementsNow: ["other"] }),
    CONFIG,
  );
  expect(await withSync.hasActiveSyncEntitlement()).toBe(true);
  expect(await withoutSync.hasActiveSyncEntitlement()).toBe(false);
});

test("restore leaves org attribution unchanged until the server accepts it", async () => {
  const backend = createFakeBackend({ entitlementsNow: ["sync"] });
  const purchases = createRevenueCatPurchases(backend, CONFIG);

  const result = await purchases.restore();

  expect(result).toEqual({ syncEntitlementActive: true });
  expect(backend.attributes).toEqual({});
  expect(backend.calls).not.toContain("setAttributes");

  await purchases.bindOrganization({ organizationId: "org-new" });
  expect(backend.attributes).toEqual({ orgId: "org-new" });
  expect(backend.calls.indexOf("setAttributes")).toBeGreaterThan(
    backend.calls.indexOf("restorePurchases"),
  );
  expect(purchases.nativeStore).toBe("test_store");
});

test("restore rejects instead of waiting forever for the provider", async () => {
  const backend = createFakeBackend();
  backend.restorePurchases = () => new Promise(() => {});
  const purchases = createRevenueCatPurchases(backend, {
    ...CONFIG,
    operationTimeoutMs: 5,
  });

  await expect(purchases.restore()).rejects.toThrow(
    "RevenueCat restore timed out after 5ms",
  );
});

test("restore waits for a queued identity transition", async () => {
  const backend = createFakeBackend();
  const login = createDeferred();
  const loginStarted = createDeferred();
  backend.logIn = async (input) => {
    backend.calls.push(`logIn:${input.appUserId}`);
    loginStarted.resolve();
    await login.promise;
  };
  const purchases = createRevenueCatPurchases(backend, CONFIG);
  await purchases.listSyncOptions();
  const identifying = purchases.identify({ userId: "user-1" });
  await loginStarted.promise;

  const restoring = purchases.restore();
  await Promise.resolve();
  expect(backend.calls).not.toContain("restorePurchases");

  login.resolve();
  await Promise.all([identifying, restoring]);
  expect(backend.calls).toContain("restorePurchases");
});

test("observation-only RevenueCat disables purchases but preserves entitlement reads", async () => {
  const backend = createFakeBackend({ entitlementsNow: ["sync"] });
  const purchases = createRevenueCatPurchases(backend, {
    ...CONFIG,
    purchasesEnabled: false,
    supportsEmbeddedCheckout: true,
  });

  expect(purchases.isAvailable).toBe(false);
  expect(purchases.supportsEmbeddedCheckout).toBe(false);
  expect(await purchases.listSyncOptions()).toEqual([]);
  await expect(
    purchases.purchaseSync({ organizationId: "org-1", packageId: "monthly" }),
  ).rejects.toBeInstanceOf(PurchasesUnavailableError);
  await expect(purchases.restore()).rejects.toBeInstanceOf(
    PurchasesUnavailableError,
  );
  await expect(
    purchases.bindOrganization({ organizationId: "org-1" }),
  ).rejects.toBeInstanceOf(PurchasesUnavailableError);
  expect(await purchases.hasActiveSyncEntitlement()).toBe(true);
  expect(backend.calls).not.toContain("getCurrentPackages");
  expect(backend.calls).not.toContain("setAttributes");
  expect(backend.calls).not.toContain("purchasePackage:monthly");
});

test("the unavailable stub degrades reads and rejects purchases", async () => {
  const purchases = createUnavailablePurchases();
  expect(purchases.isAvailable).toBe(false);
  expect(await purchases.listSyncOptions()).toEqual([]);
  expect(await purchases.hasActiveSyncEntitlement()).toBe(false);
  expect(purchases.nativeStore).toBeNull();
  await purchases.identify({ userId: "user-1" }); // no throw
  expect(
    purchases.purchaseSync({ organizationId: "org-1", packageId: "p" }),
  ).rejects.toBeInstanceOf(PurchasesUnavailableError);
});
