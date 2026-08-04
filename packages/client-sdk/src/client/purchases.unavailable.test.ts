import { expect, test } from "bun:test";
import {
  createUnavailablePurchases,
  PurchasesUnavailableError,
} from "./purchases";

test("the unavailable stub degrades reads and rejects purchases", async () => {
  const purchases = createUnavailablePurchases();
  expect(purchases.isAvailable).toBe(false);
  expect(await purchases.listSyncOptions()).toEqual([]);
  expect(await purchases.hasActiveSyncEntitlement()).toBe(false);
  expect(purchases.nativeStore).toBeNull();
  await purchases.identify({ userId: "user-1" });
  await expect(
    purchases.purchaseSync({ organizationId: "org-1", packageId: "p" }),
  ).rejects.toBeInstanceOf(PurchasesUnavailableError);
  await expect(
    purchases.moveNativeSubscription({
      claim: () => Promise.resolve(true),
      organizationId: "org-1",
      userId: "user-1",
    }),
  ).rejects.toBeInstanceOf(PurchasesUnavailableError);
});
