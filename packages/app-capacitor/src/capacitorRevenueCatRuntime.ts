import { Capacitor } from "@capacitor/core";
import type { PurchasesCapability } from "@tearleads/client-sdk";

interface CachedCapacitorPurchases {
  readonly apiKey: string;
  readonly capability: PurchasesCapability;
  readonly operationTimeoutMs: number | undefined;
  readonly platform: string;
  readonly syncEntitlementId: string;
}

interface NativeRevenueCatPurchasePlugin {
  preparePackage(options: {
    packageId: string;
    productId: string;
  }): Promise<void>;
  purchasePackage(options: {
    oldProductIdentifier?: string;
    packageId: string;
    productId: string;
    replacementMode?: string;
  }): Promise<{ activeEntitlementIds?: unknown }>;
}

export function getRevenueCatPlatform(): string {
  return Capacitor.getPlatform();
}

let nativeRevenueCatPurchase: NativeRevenueCatPurchasePlugin | undefined;
let cachedCapacitorPurchases: CachedCapacitorPurchases | undefined;

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
  nativeRevenueCatPurchase ??=
    Capacitor.registerPlugin<NativeRevenueCatPurchasePlugin>(
      "RevenueCatPurchase",
    );
  return nativeRevenueCatPurchase;
}
