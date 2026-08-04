import type {
  CustomerInfo,
  Purchases,
  PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import type { RevenueCatCustomerInfo } from "@tearleads/client-sdk";
import { getNativeRevenueCatPurchase } from "./capacitorRevenueCatRuntime";

type NativePurchaseChangeOptions = Pick<
  Parameters<typeof Purchases.purchasePackage>[0],
  "storeProductChangeInfo"
>;

type NativeReplacementMode = NonNullable<
  NonNullable<
    NativePurchaseChangeOptions["storeProductChangeInfo"]
  >["replacementMode"]
>;

export interface NativeProductChangeInput {
  readonly oldProductIdentifier: string;
  readonly replacementMode: NativeReplacementMode;
}

export function nativeProductChangeInput(
  change: NativePurchaseChangeOptions["storeProductChangeInfo"],
): NativeProductChangeInput | undefined {
  if (change == null) return undefined;
  if (!change.oldProductIdentifier || change.replacementMode === undefined) {
    throw new Error("Android product changes require both store fields");
  }
  return {
    oldProductIdentifier: change.oldProductIdentifier,
    replacementMode: change.replacementMode,
  };
}

function nativePackageInput(aPackage: PurchasesPackage) {
  return {
    packageId: aPackage?.identifier ?? "",
    productId: aPackage?.product?.identifier ?? "",
  };
}

/** Resolves the native package while checkout preparation has a deadline. */
export async function prepareCapacitorRevenueCatPackage(
  aPackage: PurchasesPackage,
): Promise<void> {
  await getNativeRevenueCatPurchase().preparePackage(
    nativePackageInput(aPackage),
  );
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

/**
 * Purchases the package resolved by the bounded first-party native preparation.
 * The bridge changes no RevenueCat configuration or non-purchase operation.
 */
export async function purchaseCapacitorRevenueCatPackage(
  aPackage: PurchasesPackage,
  change?: NativeProductChangeInput,
): Promise<RevenueCatCustomerInfo> {
  const result = await getNativeRevenueCatPurchase().purchasePackage({
    ...nativePackageInput(aPackage),
    ...(change ?? {}),
  });
  return fromActiveEntitlementIds(
    normalizeActiveEntitlementIds(result?.activeEntitlementIds),
  );
}
