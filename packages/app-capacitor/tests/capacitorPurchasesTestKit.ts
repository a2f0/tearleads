import { mock } from "bun:test";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";

export const fixture: {
  platform: string;
  configureCalls: { apiKey: string; appUserID?: string }[];
  logInCalls: string[];
  logOutCalls: number;
  logOutRejection: unknown;
  purchaseCalls: {
    identifier: string;
    storeProductChangeInfo?: {
      oldProductIdentifier: string;
      replacementMode: string;
    };
  }[];
  nativePrepareCalls: { identifier: string; productId: string }[];
  nativePurchaseCalls: { identifier: string; productId: string }[];
  attributeCalls: Record<string, string | null>[];
  packages: PurchasesPackage[];
  purchaseRejection: unknown;
  nativePurchaseRejection: unknown;
  nativePurchasePromise: Promise<{ activeEntitlementIds?: unknown }> | null;
  onNativePurchase: (() => void) | null;
  nativePrepareRejection: unknown;
  nativePreparePromise: Promise<void> | null;
  customerInfo: unknown;
  nativePurchaseResult: { activeEntitlementIds?: unknown } | null;
  onGetOfferings: (() => void) | null;
  offeringsPromise: Promise<{
    current: { availablePackages: PurchasesPackage[] };
  }> | null;
} = {
  platform: "ios",
  configureCalls: [],
  logInCalls: [],
  logOutCalls: 0,
  logOutRejection: null,
  purchaseCalls: [],
  nativePrepareCalls: [],
  nativePurchaseCalls: [],
  attributeCalls: [],
  packages: [],
  purchaseRejection: null,
  nativePurchaseRejection: null,
  nativePurchasePromise: null,
  onNativePurchase: null,
  nativePrepareRejection: null,
  nativePreparePromise: null,
  customerInfo: { entitlements: { active: { sync: {} } } },
  nativePurchaseResult: null,
  onGetOfferings: null,
  offeringsPromise: null,
};

export function nativePackage(identifier: string, productId: string) {
  return {
    identifier,
    product: {
      identifier: productId,
      title: "Sync",
      description: "Organization sync",
      priceString: "$4.99",
    },
  } as unknown as PurchasesPackage;
}

mock.module("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => fixture.platform,
    isNativePlatform: () => fixture.platform !== "web",
    isPluginAvailable: () => fixture.platform !== "web",
    registerPlugin: (name: string) => {
      if (name !== "RevenueCatPurchase") {
        return { show: () => Promise.resolve() };
      }
      return {
        preparePackage: ({
          packageId,
          productId,
        }: {
          packageId: string;
          productId: string;
        }) => {
          fixture.nativePrepareCalls.push({
            identifier: packageId,
            productId,
          });
          if (fixture.nativePreparePromise !== null) {
            return fixture.nativePreparePromise;
          }
          return fixture.nativePrepareRejection === null
            ? Promise.resolve()
            : Promise.reject(fixture.nativePrepareRejection);
        },
        purchasePackage: ({
          packageId,
          productId,
        }: {
          packageId: string;
          productId: string;
        }) => {
          fixture.nativePurchaseCalls.push({
            identifier: packageId,
            productId,
          });
          fixture.onNativePurchase?.();
          if (!packageId || !productId) {
            return Promise.reject({
              code: "bridge-invalid",
              message: "RevenueCat purchase failed",
              data: { userCancelled: false },
            });
          }
          if (fixture.nativePurchaseRejection !== null) {
            return Promise.reject(fixture.nativePurchaseRejection);
          }
          if (fixture.nativePurchasePromise !== null) {
            return fixture.nativePurchasePromise;
          }
          if (fixture.purchaseRejection !== null) {
            return Promise.reject(fixture.purchaseRejection);
          }
          if (fixture.nativePurchaseResult !== null) {
            return Promise.resolve(fixture.nativePurchaseResult);
          }
          const customerInfo = fixture.customerInfo;
          const activeEntitlements =
            typeof customerInfo === "object" &&
            customerInfo !== null &&
            "entitlements" in customerInfo &&
            typeof customerInfo.entitlements === "object" &&
            customerInfo.entitlements !== null &&
            "active" in customerInfo.entitlements &&
            typeof customerInfo.entitlements.active === "object" &&
            customerInfo.entitlements.active !== null
              ? Object.keys(customerInfo.entitlements.active)
              : [];
          return Promise.resolve({ activeEntitlementIds: activeEntitlements });
        },
      };
    },
  },
}));

mock.module("@revenuecat/purchases-capacitor", () => ({
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: "1",
    PRODUCT_ALREADY_PURCHASED_ERROR: "6",
    RECEIPT_ALREADY_IN_USE_ERROR: "7",
    RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: "13",
    LOG_OUT_ANONYMOUS_USER_ERROR: "22",
  },
  STORE_REPLACEMENT_MODE: {
    CHARGE_PRORATED_PRICE: "CHARGE_PRORATED_PRICE",
    DEFERRED: "DEFERRED",
  },
  Purchases: {
    configure: (options: { apiKey: string; appUserID?: string }) => {
      fixture.configureCalls.push(options);
      return Promise.resolve();
    },
    logIn: ({ appUserID }: { appUserID: string }) => {
      fixture.logInCalls.push(appUserID);
      return Promise.resolve();
    },
    logOut: () => {
      fixture.logOutCalls += 1;
      return fixture.logOutRejection === null
        ? Promise.resolve()
        : Promise.reject(fixture.logOutRejection);
    },
    setAttributes: (attributes: Record<string, string | null>) => {
      fixture.attributeCalls.push(attributes);
      return Promise.resolve();
    },
    getOfferings: () => {
      fixture.onGetOfferings?.();
      return (
        fixture.offeringsPromise ??
        Promise.resolve({
          current: { availablePackages: fixture.packages },
        })
      );
    },
    purchasePackage: (options: {
      aPackage: PurchasesPackage;
      storeProductChangeInfo?: {
        oldProductIdentifier: string;
        replacementMode: string;
      };
    }) => {
      fixture.purchaseCalls.push({
        identifier: options.aPackage.identifier,
        ...(options.storeProductChangeInfo
          ? { storeProductChangeInfo: options.storeProductChangeInfo }
          : {}),
      });
      if (fixture.purchaseRejection !== null) {
        return Promise.reject(fixture.purchaseRejection);
      }
      return Promise.resolve({ customerInfo: fixture.customerInfo });
    },
    getCustomerInfo: () =>
      Promise.resolve({ customerInfo: fixture.customerInfo }),
    restorePurchases: () =>
      Promise.resolve({ customerInfo: fixture.customerInfo }),
  },
}));

export const { createCapacitorPurchases } = await import(
  "../src/capacitorPurchases"
);

export function purchaseSync(packageId = "monthly", abortSignal?: AbortSignal) {
  return createCapacitorPurchases().purchaseSync({
    organizationId: "org-1",
    packageId,
    ...(abortSignal ? { abortSignal } : {}),
  });
}

const ENV_KEYS = [
  "VITE_REVENUECAT_IOS_API_KEY",
  "VITE_REVENUECAT_ANDROID_API_KEY",
  "VITE_REVENUECAT_SYNC_ENTITLEMENT",
] as const;

export function setEnv(key: (typeof ENV_KEYS)[number], value: string): void {
  process.env[key] = value;
}

export function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

export function resetFixture(): void {
  fixture.platform = "ios";
  fixture.configureCalls = [];
  fixture.logInCalls = [];
  fixture.logOutCalls = 0;
  fixture.logOutRejection = null;
  fixture.purchaseCalls = [];
  fixture.nativePrepareCalls = [];
  fixture.nativePurchaseCalls = [];
  fixture.attributeCalls = [];
  fixture.packages = [];
  fixture.purchaseRejection = null;
  fixture.nativePurchaseRejection = null;
  fixture.nativePurchasePromise = null;
  fixture.onNativePurchase = null;
  fixture.nativePrepareRejection = null;
  fixture.nativePreparePromise = null;
  fixture.customerInfo = { entitlements: { active: { sync: {} } } };
  fixture.nativePurchaseResult = null;
  fixture.onGetOfferings = null;
  fixture.offeringsPromise = null;
  clearEnv();
  // Calling the factory without a platform key clears its process-wide native
  // capability, keeping tests isolated while production keys stay immutable.
  createCapacitorPurchases();
}
