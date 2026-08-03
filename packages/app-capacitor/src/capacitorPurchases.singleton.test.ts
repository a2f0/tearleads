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
