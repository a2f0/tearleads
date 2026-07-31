import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import type { RevenueCatCustomerInfo } from "@tearleads/client-sdk";

interface NativeRevenueCatPurchasePlugin {
  purchasePackage(options: {
    packageId: string;
    productId: string;
  }): Promise<{ activeEntitlementIds?: unknown }>;
}

let nativeRevenueCatPurchase: NativeRevenueCatPurchasePlugin | undefined;

function getNativeRevenueCatPurchase(): NativeRevenueCatPurchasePlugin {
  nativeRevenueCatPurchase ??=
    Capacitor.registerPlugin<NativeRevenueCatPurchasePlugin>(
      "RevenueCatPurchase",
    );
  return nativeRevenueCatPurchase;
}

export function toRevenueCatCustomerInfo(
  activeEntitlementIds: readonly string[],
): RevenueCatCustomerInfo {
  return {
    activeEntitlementIds: [...activeEntitlementIds],
  };
}

function normalizeActiveEntitlementIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Purchases through the first-party iOS bridge so RevenueCat's bounded native
 * diagnostics survive a rejection. Android keeps the official Capacitor path;
 * the bridge changes no RevenueCat configuration or non-purchase operation.
 */
export async function purchaseCapacitorRevenueCatPackage(
  aPackage: PurchasesPackage,
): Promise<RevenueCatCustomerInfo> {
  if (Capacitor.getPlatform() !== "ios") {
    const result = await Purchases.purchasePackage({ aPackage });
    return toRevenueCatCustomerInfo(
      Object.keys(result?.customerInfo?.entitlements?.active ?? {}),
    );
  }

  const result = await getNativeRevenueCatPurchase().purchasePackage({
    packageId: aPackage?.identifier ?? "",
    productId: aPackage?.product?.identifier ?? "",
  });
  return toRevenueCatCustomerInfo(
    normalizeActiveEntitlementIds(result?.activeEntitlementIds),
  );
}
