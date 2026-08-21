import { expect, test } from "bun:test";
import { STORE_REPLACEMENT_MODE } from "@revenuecat/purchases-capacitor";
import type { PurchasesCapability } from "@symcrypt/client-sdk";
import {
  getCachedCapacitorPurchases,
  setCachedCapacitorPurchases,
} from "./capacitorPurchasesCache";
import { nativeProductChangeInput } from "./capacitorRevenueCatPurchase";

test("production runtime selects the platform and registers once", async () => {
  const fixturePath = `${import.meta.dir}/../../tests/fixtures/capacitorRevenueCatRuntime.fixture.ts`;
  const child = Bun.spawn([process.execPath, fixturePath], {
    cwd: import.meta.dir,
    stderr: "pipe",
    stdout: "ignore",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("stores and clears the production capability singleton", () => {
  const capability = { isAvailable: true } as PurchasesCapability;
  const cached = {
    apiKey: "test-key",
    capability,
    operationTimeoutMs: undefined,
    platform: "ios",
    syncEntitlementId: "sync",
  };

  setCachedCapacitorPurchases(cached);
  expect(getCachedCapacitorPurchases()).toBe(cached);
  setCachedCapacitorPurchases(undefined);
  expect(getCachedCapacitorPurchases()).toBeUndefined();
});

test("forwards Android product-change fields atomically", () => {
  expect(() =>
    nativeProductChangeInput({ oldProductIdentifier: "sync_solo_monthly" }),
  ).toThrow("Android product changes require both store fields");
  expect(
    nativeProductChangeInput({
      oldProductIdentifier: "sync_solo_monthly",
      replacementMode: STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
    }),
  ).toEqual({
    oldProductIdentifier: "sync_solo_monthly",
    replacementMode: STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
  });
});
