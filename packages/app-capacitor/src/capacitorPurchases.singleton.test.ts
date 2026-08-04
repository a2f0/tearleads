import { afterEach, expect, test } from "bun:test";
import { PurchaseIdentityPendingError } from "@tearleads/client-sdk";
import {
  createCapacitorPurchases,
  fixture,
  nativePackage,
  resetFixture,
  setEnv,
} from "../tests/capacitorPurchasesTestKit";

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
  fixture.packages = [nativePackage("monthly", "com.tearleads.sync.monthly")];
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

test("factory caches capabilities by their operation timeout", () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  const firstCapability = createCapacitorPurchases({ operationTimeoutMs: 5 });

  expect(() => createCapacitorPurchases({ operationTimeoutMs: 0 })).toThrow(
    "RevenueCat operation timeout must be a positive finite number",
  );
  expect(createCapacitorPurchases({ operationTimeoutMs: 10 })).not.toBe(
    firstCapability,
  );
  const matchingCapability = createCapacitorPurchases({
    operationTimeoutMs: 5,
  });
  expect(createCapacitorPurchases({ operationTimeoutMs: 5 })).toBe(
    matchingCapability,
  );
});

test("an iOS Test Store restore remains buyer paced", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "test_ios-key");
  const restoreResult = createDeferred<{ customerInfo: unknown }>();
  fixture.restorePromise = restoreResult.promise;
  const restoring = createCapacitorPurchases({
    operationTimeoutMs: 5,
  }).restore();

  const earlyOutcome = await Promise.race([
    restoring.then(
      () => "settled",
      () => "settled",
    ),
    new Promise<"pending">((resolve) =>
      setTimeout(() => resolve("pending"), 20),
    ),
  ]);

  expect(earlyOutcome).toBe("pending");
  restoreResult.resolve({ customerInfo: fixture.customerInfo });
  await expect(restoring).resolves.toEqual({ syncEntitlementActive: true });
});
