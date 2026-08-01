import { Capacitor } from "@capacitor/core";
import {
  type CustomerInfo,
  Purchases,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import type { RevenueCatCustomerInfo } from "@tearleads/client-sdk";

type OfficialPurchaseOptions = Omit<
  Parameters<typeof Purchases.purchasePackage>[0],
  "aPackage"
>;

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
  activeEntitlementIds: string[],
): RevenueCatCustomerInfo {
  return {
    activeEntitlementIds,
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

function isBridgeValidationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "bridge-invalid"
  );
}

async function purchaseThroughOfficialBridge(
  aPackage: PurchasesPackage,
  options: OfficialPurchaseOptions,
): Promise<RevenueCatCustomerInfo> {
  const result = await Purchases.purchasePackage({ aPackage, ...options });
  return fromCapacitorCustomerInfo(result?.customerInfo);
}

/**
 * Purchases through the first-party iOS bridge so RevenueCat's bounded native
 * diagnostics survive a rejection. Android keeps the official Capacitor path;
 * the bridge changes no RevenueCat configuration or non-purchase operation.
 */
export async function purchaseCapacitorRevenueCatPackage(
  aPackage: PurchasesPackage,
  options: OfficialPurchaseOptions = {},
): Promise<RevenueCatCustomerInfo> {
  if (Capacitor.getPlatform() !== "ios") {
    return purchaseThroughOfficialBridge(aPackage, options);
  }

  try {
    const result = await getNativeRevenueCatPurchase().purchasePackage({
      packageId: aPackage?.identifier ?? "",
      productId: aPackage?.product?.identifier ?? "",
    });
    return fromActiveEntitlementIds(
      normalizeActiveEntitlementIds(result?.activeEntitlementIds),
    );
  } catch (error) {
    if (!isBridgeValidationError(error)) {
      throw error;
    }
    return purchaseThroughOfficialBridge(aPackage, options);
  }
}
