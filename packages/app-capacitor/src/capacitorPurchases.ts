import { Capacitor } from "@capacitor/core";
import {
  PURCHASES_ERROR_CODE,
  Purchases,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import {
  createRevenueCatPurchases,
  createUnavailablePurchases,
  PurchaseAbortedError,
  PurchaseCancelledError,
  type PurchasesCapability,
  type RevenueCatBackend,
  type RevenueCatPackage,
} from "@tearleads/client-sdk";
import {
  fromCapacitorCustomerInfo,
  purchaseCapacitorRevenueCatPackage,
} from "./capacitorRevenueCatPurchase";

const DEFAULT_SYNC_ENTITLEMENT_ID = "sync";

function toRevenueCatPackage(entry: PurchasesPackage): RevenueCatPackage {
  return {
    identifier: entry?.identifier ?? "",
    productIdentifier: entry?.product?.identifier ?? "",
    title: entry?.product?.title ?? "",
    description: entry?.product?.description ?? "",
    priceString: entry?.product?.priceString ?? "",
  };
}

async function currentPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  return offerings?.current?.availablePackages ?? [];
}

/**
 * True when the native SDK rejected because the buyer dismissed the store
 * sheet rather than because the purchase failed.
 *
 * The official Android bridge and first-party iOS bridge both reject with a
 * plain object — not an `Error` instance — which is why this reads the shape
 * instead of using `instanceof` the way the web adapter can. `code` is the
 * documented signal.
 */
function isUserCancelledPurchase(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  // Narrowed with `in` rather than a cast: production package sources may not
  // contain type assertions (lint:package-assertions).
  return (
    "code" in error &&
    error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
  );
}

/**
 * Adapts the native `@revenuecat/purchases-capacitor` plugin to the client-sdk
 * {@link RevenueCatBackend}. Only the normalized surface the sdk consumes is
 * exposed; the sdk owns the configure-once / entitlement-mapping logic.
 */
const capacitorRevenueCatBackend: RevenueCatBackend = {
  async configure({ apiKey, appUserId }) {
    // Configure straight onto the known buyer when the sdk has one. Dropping
    // it configures anonymously and lets the following logIn alias that
    // throwaway anonymous id onto the real user, which leaves a stray
    // anonymous customer in RevenueCat for every fresh install.
    await Purchases.configure({
      apiKey,
      ...(appUserId === undefined ? {} : { appUserID: appUserId }),
    });
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
  async purchasePackage({ packageId, abortSignal }) {
    if (abortSignal?.aborted) {
      throw new PurchaseAbortedError();
    }
    const aPackage = (await currentPackages()).find(
      (entry) => entry?.identifier === packageId,
    );
    // This is the last abort-aware await. The iOS diagnostic bridge validates
    // the package with one more native offerings fetch, but neither that call
    // nor a presented StoreKit / Play sheet has programmatic cancellation.
    // A caller that abandoned the flow while this offerings request was loading
    // must not get a modal purchase sheet for a flow nobody awaits any more.
    // Aborted takes precedence over a missing package so an abandoned flow's
    // outcome stays a pre-sheet abort, matching webPurchases.ts.
    if (abortSignal?.aborted) {
      throw new PurchaseAbortedError();
    }
    if (!aPackage) {
      throw new Error(`Unknown purchase package: ${packageId}`);
    }
    try {
      return await purchaseCapacitorRevenueCatPackage(aPackage);
    } catch (error) {
      // Backing out of the store sheet is a normal exit, not a failure.
      // Without this the panel surfaces "Failed to subscribe" and logs an
      // error every time a buyer dismisses the sheet, because
      // useSubscribeAction only treats PurchaseCancelledError as a no-op.
      if (isUserCancelledPurchase(error)) {
        throw new PurchaseCancelledError();
      }
      throw error;
    }
  },
  async getCustomerInfo() {
    const result = await Purchases.getCustomerInfo();
    return fromCapacitorCustomerInfo(result?.customerInfo);
  },
  async restorePurchases() {
    const result = await Purchases.restorePurchases();
    return fromCapacitorCustomerInfo(result?.customerInfo);
  },
};

function readEnvString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readPlatformApiKey(): string | undefined {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") {
    return readEnvString(import.meta.env?.VITE_REVENUECAT_IOS_API_KEY);
  }
  if (platform === "android") {
    return readEnvString(import.meta.env?.VITE_REVENUECAT_ANDROID_API_KEY);
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
      readEnvString(import.meta.env?.VITE_REVENUECAT_SYNC_ENTITLEMENT) ??
      DEFAULT_SYNC_ENTITLEMENT_ID,
  });
}
