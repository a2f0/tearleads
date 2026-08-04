import {
  PURCHASES_ERROR_CODE,
  Purchases,
  type PurchasesPackage,
  STORE_REPLACEMENT_MODE,
} from "@revenuecat/purchases-capacitor";
import {
  createRevenueCatPurchases,
  createUnavailablePurchases,
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  type PurchasesCapability,
  PurchasesUnavailableError,
  type RevenueCatBackend,
  type RevenueCatPackage,
} from "@tearleads/client-sdk";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import {
  fromCapacitorCustomerInfo,
  prepareCapacitorRevenueCatPackage,
  purchaseCapacitorRevenueCatPackage,
} from "./capacitorRevenueCatPurchase";
import {
  getCachedCapacitorPurchases,
  getRevenueCatPlatform,
  setCachedCapacitorPurchases,
} from "./capacitorRevenueCatRuntime";

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

function googleProductId(productIdentifier: string): string {
  const [productId] = productIdentifier.split(":", 1);
  return productId || productIdentifier;
}

async function androidProductChangeOptions(targetProductId: string) {
  if (getRevenueCatPlatform() !== "android") {
    return {};
  }
  const result = await Purchases.getCustomerInfo();
  const entitlementId =
    readEnvString(import.meta.env?.VITE_REVENUECAT_SYNC_ENTITLEMENT) ??
    DEFAULT_SYNC_ENTITLEMENT_ID;
  const activeEntitlement =
    result?.customerInfo?.entitlements?.active?.[entitlementId];
  const currentProductId = activeEntitlement?.productIdentifier;
  if (
    activeEntitlement?.store !== "PLAY_STORE" ||
    !currentProductId ||
    googleProductId(currentProductId) === googleProductId(targetProductId)
  ) {
    return {};
  }
  const currentTier = getSyncBillingTierForNativeProduct(currentProductId);
  const targetTier = getSyncBillingTierForNativeProduct(targetProductId);
  if (!currentTier || !targetTier) {
    return {};
  }
  return {
    storeProductChangeInfo: {
      oldProductIdentifier: googleProductId(currentProductId),
      replacementMode:
        targetTier.seatLimit > currentTier.seatLimit
          ? STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE
          : STORE_REPLACEMENT_MODE.DEFERRED,
    },
  };
}

class CapacitorPreparedPurchase {
  constructor(
    readonly aPackage: PurchasesPackage,
    readonly productChangeOptions: Awaited<
      ReturnType<typeof androidProductChangeOptions>
    >,
  ) {}
}

async function prepareCapacitorPurchase(input: {
  readonly abortSignal?: AbortSignal;
  readonly packageId: string;
}): Promise<CapacitorPreparedPurchase> {
  if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
  const aPackage = (await currentPackages()).find(
    (entry) => entry?.identifier === input.packageId,
  );
  if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
  if (!aPackage) {
    throw new Error(`Unknown purchase package: ${input.packageId}`);
  }
  const productIdentifier = aPackage.product?.identifier ?? "";
  if (!getSyncBillingTierForNativeProduct(productIdentifier)) {
    throw new Error(`Unknown sync subscription product: ${productIdentifier}`);
  }
  const productChangeOptions =
    await androidProductChangeOptions(productIdentifier);
  if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
  await prepareCapacitorRevenueCatPackage(aPackage);
  if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
  return new CapacitorPreparedPurchase(aPackage, productChangeOptions);
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

function isAlreadyOwnedPurchase(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    error.code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR ||
    error.code === PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR ||
    error.code === PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR
  );
}

function isAnonymousLogOut(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR
  );
}

function isInvalidNativePurchaseBridge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "bridge-invalid"
  );
}

class NativePurchaseBridgeUnavailableError extends PurchasesUnavailableError {
  readonly code = "bridge-invalid";

  constructor(cause: unknown) {
    super("The native purchase bridge could not validate this package", {
      cause,
    });
    this.name = "NativePurchaseBridgeUnavailableError";
  }
}

function normalizeCapacitorPurchaseError(error: unknown): never {
  if (isUserCancelledPurchase(error)) {
    throw new PurchaseCancelledError();
  }
  if (isAlreadyOwnedPurchase(error)) {
    throw new PurchaseAlreadyOwnedError();
  }
  if (isInvalidNativePurchaseBridge(error)) {
    throw new NativePurchaseBridgeUnavailableError(error);
  }
  throw error;
}

function normalizeCapacitorPreparationError(
  error: unknown,
  abortSignal: AbortSignal | undefined,
): never {
  if (abortSignal?.aborted) throw new PurchaseAbortedError();
  if (isInvalidNativePurchaseBridge(error)) {
    throw new NativePurchaseBridgeUnavailableError(error);
  }
  throw error;
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
    try {
      await Purchases.logOut();
    } catch (error) {
      // RevenueCat rejects logOut for an already-anonymous buyer. That is the
      // requested end state, so make reset idempotent across fresh installs.
      if (!isAnonymousLogOut(error)) throw error;
    }
  },
  async setAttributes(attributes) {
    await Purchases.setAttributes(attributes);
  },
  async getCurrentPackages() {
    return (await currentPackages()).map(toRevenueCatPackage);
  },
  async preparePurchasePackage(input) {
    return prepareCapacitorPurchase(input).catch((error: unknown) =>
      normalizeCapacitorPreparationError(error, input.abortSignal),
    );
  },
  async purchasePackage({ abortSignal, packageId, preparedPurchase }) {
    if (abortSignal?.aborted) throw new PurchaseAbortedError();
    if (
      !(preparedPurchase instanceof CapacitorPreparedPurchase) ||
      preparedPurchase.aPackage.identifier !== packageId
    ) {
      throw new Error(`Purchase package was not prepared: ${packageId}`);
    }
    try {
      return await purchaseCapacitorRevenueCatPackage(
        preparedPurchase.aPackage,
        preparedPurchase.productChangeOptions,
      );
    } catch (error) {
      normalizeCapacitorPurchaseError(error);
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

function validateOperationTimeoutMs(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(
      "RevenueCat operation timeout must be a positive finite number",
    );
  }
}

function readPlatformApiKey(): string | undefined {
  const platform = getRevenueCatPlatform();
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
export function createCapacitorPurchases(input?: {
  readonly operationTimeoutMs?: number;
}): PurchasesCapability {
  const operationTimeoutMs = input?.operationTimeoutMs;
  validateOperationTimeoutMs(operationTimeoutMs);
  const platform = getRevenueCatPlatform();
  const apiKey = readPlatformApiKey();
  if (!apiKey) {
    return createUnavailablePurchases();
  }
  const syncEntitlementId =
    readEnvString(import.meta.env?.VITE_REVENUECAT_SYNC_ENTITLEMENT) ??
    DEFAULT_SYNC_ENTITLEMENT_ID;
  const cached = getCachedCapacitorPurchases();
  if (
    cached?.apiKey === apiKey &&
    cached.operationTimeoutMs === operationTimeoutMs &&
    cached.platform === platform &&
    cached.syncEntitlementId === syncEntitlementId
  ) {
    return cached.capability;
  }
  const capability = createRevenueCatPurchases(capacitorRevenueCatBackend, {
    apiKey,
    nativeStore: apiKey.startsWith("test_")
      ? "test_store"
      : platform === "ios"
        ? "app_store"
        : "play_store",
    restorePurchasesBuyerPaced: platform === "ios",
    syncEntitlementId,
    ...(operationTimeoutMs === undefined ? {} : { operationTimeoutMs }),
  });
  setCachedCapacitorPurchases({
    apiKey,
    capability,
    operationTimeoutMs,
    platform,
    syncEntitlementId,
  });
  return capability;
}
