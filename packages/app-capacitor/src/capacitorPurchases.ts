import { Capacitor } from "@capacitor/core";
import {
  type CustomerInfo,
  Purchases,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import {
  createRevenueCatPurchases,
  createUnavailablePurchases,
  type PurchasesCapability,
  type RevenueCatBackend,
  type RevenueCatCustomerInfo,
  type RevenueCatPackage,
} from "@tearleads/client-sdk";

const DEFAULT_SYNC_ENTITLEMENT_ID = "sync";

// The native bridge is effectively untyped at runtime; guard against a
// malformed/partial CustomerInfo or package so a bad payload can't crash the app.
function toRevenueCatCustomerInfo(info: CustomerInfo): RevenueCatCustomerInfo {
  return {
    activeEntitlementIds: Object.keys(info?.entitlements?.active ?? {}),
  };
}

function toRevenueCatPackage(entry: PurchasesPackage): RevenueCatPackage {
  return {
    identifier: entry.identifier,
    productIdentifier: entry.product?.identifier ?? "",
    title: entry.product?.title ?? "",
    description: entry.product?.description ?? "",
    priceString: entry.product?.priceString ?? "",
  };
}

async function currentPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

/**
 * Adapts the native `@revenuecat/purchases-capacitor` plugin to the client-sdk
 * {@link RevenueCatBackend}. Only the normalized surface the sdk consumes is
 * exposed; the sdk owns the configure-once / entitlement-mapping logic.
 */
const capacitorRevenueCatBackend: RevenueCatBackend = {
  async configure({ apiKey }) {
    await Purchases.configure({ apiKey });
  },
  async logIn({ appUserId }) {
    await Purchases.logIn({ appUserID: appUserId });
  },
  async logOut() {
    await Purchases.logOut();
  },
  async setAttributes(attributes) {
    await Purchases.setAttributes(attributes);
  },
  async getCurrentPackages() {
    return (await currentPackages()).map(toRevenueCatPackage);
  },
  async purchasePackage({ packageId }) {
    const aPackage = (await currentPackages()).find(
      (entry) => entry.identifier === packageId,
    );
    if (!aPackage) {
      throw new Error(`Unknown purchase package: ${packageId}`);
    }
    const result = await Purchases.purchasePackage({ aPackage });
    return toRevenueCatCustomerInfo(result.customerInfo);
  },
  async getCustomerInfo() {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return toRevenueCatCustomerInfo(customerInfo);
  },
  async restorePurchases() {
    const { customerInfo } = await Purchases.restorePurchases();
    return toRevenueCatCustomerInfo(customerInfo);
  },
};

function readEnvString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readPlatformApiKey(): string | undefined {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") {
    return readEnvString(import.meta.env.VITE_REVENUECAT_IOS_API_KEY);
  }
  if (platform === "android") {
    return readEnvString(import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY);
  }
  // Web preview (e.g. `cap run` in a browser) has no native purchases.
  return undefined;
}

/**
 * Builds the Capacitor {@link PurchasesCapability}. On a native platform with a
 * configured RevenueCat public SDK key it returns the real implementation;
 * otherwise (web preview, or key not yet provisioned) it degrades to the
 * unavailable stub so the app still runs.
 */
export function createCapacitorPurchases(): PurchasesCapability {
  const apiKey = readPlatformApiKey();
  if (!apiKey) {
    return createUnavailablePurchases();
  }
  return createRevenueCatPurchases(capacitorRevenueCatBackend, {
    apiKey,
    syncEntitlementId:
      readEnvString(import.meta.env.VITE_REVENUECAT_SYNC_ENTITLEMENT) ??
      DEFAULT_SYNC_ENTITLEMENT_ID,
  });
}
