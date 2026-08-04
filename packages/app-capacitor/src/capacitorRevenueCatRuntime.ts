import { Capacitor } from "@capacitor/core";
import type { PurchasesCapability } from "@tearleads/client-sdk";
import {
  createNativeRevenueCatPurchaseRegistry,
  type NativeRevenueCatPurchasePlugin,
} from "./nativeRevenueCatPurchaseRegistry";

interface CachedCapacitorPurchases {
  readonly apiKey: string;
  readonly capability: PurchasesCapability;
  readonly operationTimeoutMs: number | undefined;
  readonly platform: string;
  readonly syncEntitlementId: string;
}

export function getRevenueCatPlatform(): string {
  return Capacitor.getPlatform();
}

let cachedCapacitorPurchases: CachedCapacitorPurchases | undefined;
const resolveNativeRevenueCatPurchase = createNativeRevenueCatPurchaseRegistry(
  (name) => Capacitor.registerPlugin<NativeRevenueCatPurchasePlugin>(name),
);

export function getCachedCapacitorPurchases():
  | CachedCapacitorPurchases
  | undefined {
  return cachedCapacitorPurchases;
}

export function setCachedCapacitorPurchases(
  cached: CachedCapacitorPurchases,
): void {
  cachedCapacitorPurchases = cached;
}

export function getNativeRevenueCatPurchase(): NativeRevenueCatPurchasePlugin {
  return resolveNativeRevenueCatPurchase();
}
