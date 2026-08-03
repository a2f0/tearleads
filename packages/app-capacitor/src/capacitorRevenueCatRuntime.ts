import { Capacitor } from "@capacitor/core";

export interface NativeRevenueCatPurchasePlugin {
  preparePackage(options: {
    packageId: string;
    productId: string;
  }): Promise<void>;
  purchasePackage(options: {
    googleIsPersonalizedPrice?: boolean;
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

export function getNativeRevenueCatPurchase(): NativeRevenueCatPurchasePlugin {
  nativeRevenueCatPurchase ??=
    Capacitor.registerPlugin<NativeRevenueCatPurchasePlugin>(
      "RevenueCatPurchase",
    );
  return nativeRevenueCatPurchase;
}
