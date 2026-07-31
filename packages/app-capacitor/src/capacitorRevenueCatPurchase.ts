import { Capacitor } from "@capacitor/core";
import {
  type CustomerInfo,
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

function fromActiveEntitlementIds(
  activeEntitlementIds: readonly string[],
): RevenueCatCustomerInfo {
  return {
    activeEntitlementIds: [...activeEntitlementIds],
  };
}

export function fromCapacitorCustomerInfo(
  info: CustomerInfo | undefined,
): RevenueCatCustomerInfo {
  return fromActiveEntitlementIds(
    Object.keys(info?.entitlements?.active ?? {}),
  );
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
    return fromCapacitorCustomerInfo(result?.customerInfo);
  }

  const result = await getNativeRevenueCatPurchase().purchasePackage({
    packageId: aPackage?.identifier ?? "",
    productId: aPackage?.product?.identifier ?? "",
  });
  return fromActiveEntitlementIds(
    normalizeActiveEntitlementIds(result?.activeEntitlementIds),
  );
}
