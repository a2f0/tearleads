import { afterEach, expect, test } from "bun:test";
import { PurchaseIdentityPendingError } from "@symcrypt/client-sdk";
import {
  createCapacitorPurchases,
  fixture,
  nativePackage,
  resetFixture,
  setEnv,
} from "../../tests/billing/capacitorPurchasesTestKit";

afterEach(resetFixture);

function createDeferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("factory instances share native checkout identity serialization", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.packages = [nativePackage("monthly", "com.symcrypt.sync.monthly")];
  const purchaseResult = createDeferred<{ activeEntitlementIds: string[] }>();
  const purchaseStarted = createDeferred<void>();
  fixture.nativePurchasePromise = purchaseResult.promise;
  fixture.onNativePurchase = () => purchaseStarted.resolve();
  const firstCapability = createCapacitorPurchases();
  const remountedCapability = createCapacitorPurchases();

  expect(remountedCapability).toBe(firstCapability);
  const firstPurchase = firstCapability.purchaseSync({
    organizationId: "org-1",
    packageId: "monthly",
  });
  await purchaseStarted.promise;

  await expect(
    remountedCapability.purchaseSync({
      organizationId: "org-2",
      packageId: "monthly",
    }),
  ).rejects.toBeInstanceOf(PurchaseIdentityPendingError);
  expect(fixture.attributeCalls).toEqual([{ orgId: "org-1" }]);

  purchaseResult.resolve({ activeEntitlementIds: ["sync"] });
  await firstPurchase;
});

test("factory keeps its native singleton configuration immutable", () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  const firstCapability = createCapacitorPurchases({ operationTimeoutMs: 5 });

  expect(() => createCapacitorPurchases({ operationTimeoutMs: 0 })).toThrow(
    "RevenueCat operation timeout must be a positive finite number",
  );
  expect(() => createCapacitorPurchases({ operationTimeoutMs: 10 })).toThrow(
    "Capacitor purchases were already initialized with different configuration",
  );
  expect(createCapacitorPurchases({ operationTimeoutMs: 5 })).toBe(
    firstCapability,
  );
});

test("web preview validates timeout configuration consistently", () => {
  expect(() => createCapacitorPurchases({ operationTimeoutMs: 0 })).toThrow(
    "RevenueCat operation timeout must be a positive finite number",
  );
});

test("moves prior purchases atomically through the native bridge", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  const purchases = createCapacitorPurchases();
  await purchases.moveNativeSubscription({
    claim: () => Promise.resolve(true),
    organizationId: "org-1",
    userId: "user-1",
  });
  expect(fixture.configureCalls).toEqual([
    { apiKey: "ios-key", appUserID: "user-1" },
  ]);
  expect(fixture.attributeCalls).toContainEqual({ orgId: "org-1" });
});

test("an iOS Test Store native move remains buyer paced", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "test_ios-key");
  const restoreResult = createDeferred<{ customerInfo: unknown }>();
  fixture.restorePromise = restoreResult.promise;
  const moving = createCapacitorPurchases({
    operationTimeoutMs: 5,
  }).moveNativeSubscription({
    claim: () => Promise.resolve(true),
    organizationId: "org-1",
    userId: "user-1",
  });

  const earlyOutcome = await Promise.race([
    moving.then(
      () => "settled",
      () => "settled",
    ),
    new Promise<"pending">((resolve) =>
      setTimeout(() => resolve("pending"), 20),
    ),
  ]);

  expect(earlyOutcome).toBe("pending");
  restoreResult.resolve({ customerInfo: fixture.customerInfo });
  await expect(moving).resolves.toBeUndefined();
});
