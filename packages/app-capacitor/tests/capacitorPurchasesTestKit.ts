import { mock } from "bun:test";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";

export const fixture: {
  cachedPurchases: unknown;
  platform: string;
  configureCalls: { apiKey: string; appUserID?: string }[];
  nativeConfigurationChecks: number;
  nativeConfigurationRejection: unknown;
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
  nativePurchaseCalls: {
    identifier: string;
    oldProductIdentifier?: string;
    productId: string;
    replacementMode?: string;
  }[];
  attributeCalls: Record<string, string | null>[];
  packages: PurchasesPackage[];
  nativePurchaseRejection: unknown;
  nativePurchasePromise: Promise<{ activeEntitlementIds?: unknown }> | null;
  onNativePurchase: (() => void) | null;
  nativePrepareRejection: unknown;
  nativePreparePromise: Promise<void> | null;
  onNativePrepare: (() => void) | null;
  customerInfo: unknown;
  restorePromise: Promise<{ customerInfo: unknown }> | null;
  nativePurchaseResult: { activeEntitlementIds?: unknown } | null;
  onGetCustomerInfo: (() => void) | null;
  onGetOfferings: (() => void) | null;
  offeringsPromise: Promise<{
    current: { availablePackages: PurchasesPackage[] };
  }> | null;
} = {
  cachedPurchases: undefined,
  platform: "ios",
  configureCalls: [],
  nativeConfigurationChecks: 0,
  nativeConfigurationRejection: null,
  logInCalls: [],
  logOutCalls: 0,
  logOutRejection: null,
  purchaseCalls: [],
  nativePrepareCalls: [],
  nativePurchaseCalls: [],
  attributeCalls: [],
  packages: [],
  nativePurchaseRejection: null,
  nativePurchasePromise: null,
  onNativePurchase: null,
  nativePrepareRejection: null,
  nativePreparePromise: null,
  onNativePrepare: null,
  customerInfo: { entitlements: { active: { sync: {} } } },
  restorePromise: null,
  nativePurchaseResult: null,
  onGetCustomerInfo: null,
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

interface NativePurchaseInput {
  oldProductIdentifier?: string;
  packageId: string;
  productId: string;
  replacementMode?: string;
}

function recordNativePurchase(input: NativePurchaseInput): void {
  fixture.nativePurchaseCalls.push({
    identifier: input.packageId,
    ...(input.oldProductIdentifier === undefined
      ? {}
      : { oldProductIdentifier: input.oldProductIdentifier }),
    productId: input.productId,
    ...(input.replacementMode === undefined
      ? {}
      : { replacementMode: input.replacementMode }),
  });
}

function activeEntitlementIds(): string[] {
  const customerInfo = fixture.customerInfo;
  if (
    typeof customerInfo !== "object" ||
    customerInfo === null ||
    !("entitlements" in customerInfo) ||
    typeof customerInfo.entitlements !== "object" ||
    customerInfo.entitlements === null ||
    !("active" in customerInfo.entitlements) ||
    typeof customerInfo.entitlements.active !== "object" ||
    customerInfo.entitlements.active === null
  ) {
    return [];
  }
  return Object.keys(customerInfo.entitlements.active);
}

function nativePurchaseResult(input: NativePurchaseInput) {
  recordNativePurchase(input);
  fixture.onNativePurchase?.();
  if (!input.packageId || !input.productId) {
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
  if (fixture.nativePurchaseResult !== null) {
    return Promise.resolve(fixture.nativePurchaseResult);
  }
  return Promise.resolve({ activeEntitlementIds: activeEntitlementIds() });
}

const nativePurchasePlugin = {
  assertConfigured: () => {
    fixture.nativeConfigurationChecks += 1;
    return fixture.nativeConfigurationRejection === null
      ? Promise.resolve()
      : Promise.reject(fixture.nativeConfigurationRejection);
  },
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
    fixture.onNativePrepare?.();
    if (fixture.nativePreparePromise !== null) {
      return fixture.nativePreparePromise;
    }
    return fixture.nativePrepareRejection === null
      ? Promise.resolve()
      : Promise.reject(fixture.nativePrepareRejection);
  },
  purchasePackage: nativePurchaseResult,
};

mock.module("../src/capacitorRevenueCatRuntime", () => ({
  getCachedCapacitorPurchases: () => fixture.cachedPurchases,
  getRevenueCatPlatform: () => fixture.platform,
  getNativeRevenueCatPurchase: () => nativePurchasePlugin,
  setCachedCapacitorPurchases: (cached: unknown) => {
    fixture.cachedPurchases = cached;
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
    CHARGE_FULL_PRICE: "CHARGE_FULL_PRICE",
    CHARGE_PRORATED_PRICE: "CHARGE_PRORATED_PRICE",
    DEFERRED: "DEFERRED",
    WITHOUT_PRORATION: "WITHOUT_PRORATION",
    WITH_TIME_PRORATION: "WITH_TIME_PRORATION",
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
      return Promise.resolve({ customerInfo: fixture.customerInfo });
    },
    getCustomerInfo: () => {
      fixture.onGetCustomerInfo?.();
      return Promise.resolve({ customerInfo: fixture.customerInfo });
    },
    restorePurchases: () =>
      fixture.restorePromise ??
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
  fixture.cachedPurchases = undefined;
  fixture.platform = "ios";
  fixture.configureCalls = [];
  fixture.nativeConfigurationChecks = 0;
  fixture.nativeConfigurationRejection = null;
  fixture.logInCalls = [];
  fixture.logOutCalls = 0;
  fixture.logOutRejection = null;
  fixture.purchaseCalls = [];
  fixture.nativePrepareCalls = [];
  fixture.nativePurchaseCalls = [];
  fixture.attributeCalls = [];
  fixture.packages = [];
  fixture.nativePurchaseRejection = null;
  fixture.nativePurchasePromise = null;
  fixture.onNativePurchase = null;
  fixture.nativePrepareRejection = null;
  fixture.nativePreparePromise = null;
  fixture.onNativePrepare = null;
  fixture.customerInfo = { entitlements: { active: { sync: {} } } };
  fixture.restorePromise = null;
  fixture.nativePurchaseResult = null;
  fixture.onGetCustomerInfo = null;
  fixture.onGetOfferings = null;
  fixture.offeringsPromise = null;
  clearEnv();
}
