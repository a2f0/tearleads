import { expect, mock, test } from "bun:test";
import { STORE_REPLACEMENT_MODE } from "@revenuecat/purchases-capacitor";
import { nativeProductChangeInput } from "./capacitorRevenueCatPurchase";
import { createNativeRevenueCatPurchaseRegistry } from "./nativeRevenueCatPurchaseRegistry";

const nativePlugin = {
  preparePackage: mock(() => Promise.resolve()),
  purchasePackage: mock(() => Promise.resolve({ activeEntitlementIds: [] })),
};

test("registers and caches the first-party native purchase plugin", () => {
  const registrationNames: string[] = [];
  const getNativeRevenueCatPurchase = createNativeRevenueCatPurchaseRegistry(
    (name) => {
      registrationNames.push(name);
      return nativePlugin;
    },
  );

  expect(getNativeRevenueCatPurchase()).toBe(nativePlugin);
  expect(getNativeRevenueCatPurchase()).toBe(nativePlugin);
  expect(registrationNames).toEqual(["RevenueCatPurchase"]);
});

test("forwards Android product-change fields atomically", () => {
  expect(
    nativeProductChangeInput({ oldProductIdentifier: "sync_solo_monthly" }),
  ).toBeUndefined();
  expect(
    nativeProductChangeInput({
      oldProductIdentifier: "sync_solo_monthly",
      replacementMode: STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
    }),
  ).toEqual({
    oldProductIdentifier: "sync_solo_monthly",
    replacementMode: "CHARGE_PRORATED_PRICE",
  });
});
