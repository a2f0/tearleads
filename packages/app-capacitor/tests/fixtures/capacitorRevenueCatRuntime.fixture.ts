import { mock } from "bun:test";

const registrationNames: string[] = [];
const nativePlugin = {
  assertConfigured: () => Promise.resolve(),
  preparePackage: () => Promise.resolve(),
  purchasePackage: () => Promise.resolve({ activeEntitlementIds: [] }),
};

mock.module("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "android",
    registerPlugin: (name: string) => {
      registrationNames.push(name);
      return nativePlugin;
    },
  },
}));

const { getNativeRevenueCatPurchase, getRevenueCatPlatform } = await import(
  "../../src/billing/capacitorRevenueCatRuntime"
);

if (getRevenueCatPlatform() !== "android") {
  throw new Error("production runtime did not forward the native platform");
}
if (
  getNativeRevenueCatPurchase() !== nativePlugin ||
  getNativeRevenueCatPurchase() !== nativePlugin
) {
  throw new Error("production runtime did not cache the native plugin");
}
if (
  registrationNames.length !== 1 ||
  registrationNames[0] !== "RevenueCatPurchase"
) {
  throw new Error("production runtime registered an unexpected native plugin");
}
