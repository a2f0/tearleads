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

function nativePackageInput(aPackage: PurchasesPackage) {
  return {
    packageId: aPackage?.identifier ?? "",
    productId: aPackage?.product?.identifier ?? "",
  };
}

function isNativeStorePlatform(platform: string): boolean {
  return platform === "ios" || platform === "android";
}

/** Resolves the native package while checkout preparation has a deadline. */
export async function prepareCapacitorRevenueCatPackage(
  aPackage: PurchasesPackage,
): Promise<void> {
  if (!isNativeStorePlatform(Capacitor.getPlatform())) return;
  await getNativeRevenueCatPurchase().preparePackage(
    nativePackageInput(aPackage),
  );
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

async function purchaseThroughOfficialBridge(
  aPackage: PurchasesPackage,
  options: OfficialPurchaseOptions,
): Promise<RevenueCatCustomerInfo> {
  const result = await Purchases.purchasePackage({ aPackage, ...options });
  return fromCapacitorCustomerInfo(result?.customerInfo);
}

/**
 * Purchases the package resolved by the bounded first-party native preparation.
 * The bridge changes no RevenueCat configuration or non-purchase operation.
 */
export async function purchaseCapacitorRevenueCatPackage(
  aPackage: PurchasesPackage,
  options: OfficialPurchaseOptions = {},
): Promise<RevenueCatCustomerInfo> {
  if (!isNativeStorePlatform(Capacitor.getPlatform())) {
    return purchaseThroughOfficialBridge(aPackage, options);
  }

  const change = options.storeProductChangeInfo;
  const result = await getNativeRevenueCatPurchase().purchasePackage({
    ...nativePackageInput(aPackage),
    ...(options.googleIsPersonalizedPrice == null
      ? {}
      : { googleIsPersonalizedPrice: options.googleIsPersonalizedPrice }),
    ...(change == null
      ? {}
      : {
          oldProductIdentifier: change.oldProductIdentifier,
          replacementMode: change.replacementMode,
        }),
  });
  return fromActiveEntitlementIds(
    normalizeActiveEntitlementIds(result?.activeEntitlementIds),
  );
}
