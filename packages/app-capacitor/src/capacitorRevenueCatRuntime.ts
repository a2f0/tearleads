import { Capacitor } from "@capacitor/core";
import {
  createNativeRevenueCatPurchaseRegistry,
  type NativeRevenueCatPurchasePlugin,
} from "./nativeRevenueCatPurchaseRegistry";

export {
  getCachedCapacitorPurchases,
  setCachedCapacitorPurchases,
} from "./capacitorPurchasesCache";

export function getRevenueCatPlatform(): string {
  return Capacitor.getPlatform();
}

const resolveNativeRevenueCatPurchase = createNativeRevenueCatPurchaseRegistry(
  (name) => Capacitor.registerPlugin<NativeRevenueCatPurchasePlugin>(name),
);

export function getNativeRevenueCatPurchase(): NativeRevenueCatPurchasePlugin {
  return resolveNativeRevenueCatPurchase();
}
