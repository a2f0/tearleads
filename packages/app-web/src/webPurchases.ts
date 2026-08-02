import {
  type CustomerInfo,
  ErrorCode,
  Purchases,
  PurchasesError,
  type Package as WebBillingPackage,
} from "@revenuecat/purchases-js";
import {
  createRevenueCatPurchases,
  createUnavailablePurchases,
  PurchaseAbortedError,
  PurchaseCancelledError,
  type PurchasesCapability,
  type RevenueCatBackend,
  type RevenueCatCustomerInfo,
  type RevenueCatPackage,
} from "@tearleads/client-sdk";

const DEFAULT_SYNC_ENTITLEMENT_ID = "sync";

export interface RevenueCatWebSdk {
  configure(input: {
    apiKey: string;
    appUserId: string;
    flags: { collectAnalyticsEvents: false };
  }): RevenueCatWebPurchases;
  generateRevenueCatAnonymousAppUserId(): string;
}

export interface RevenueCatWebPurchases {
  changeUser(newAppUserId: string): Promise<CustomerInfo>;
  getCustomerInfo(): Promise<CustomerInfo>;
  getOfferings(): Promise<{
    readonly current: {
      readonly availablePackages: readonly WebBillingPackage[];
    } | null;
  }>;
  purchase(input: {
    rcPackage: WebBillingPackage;
    htmlTarget?: HTMLElement;
    metadata?: Record<string, string>;
  }): Promise<{ readonly customerInfo: CustomerInfo }>;
  setAttributes(attributes: Record<string, string | null>): Promise<void>;
  /** Tears the SDK singleton down so a fresh `configure` builds a new one. */
  close(): void;
}

const revenueCatWebSdk: RevenueCatWebSdk = {
  configure: (input) => Purchases.configure(input),
  generateRevenueCatAnonymousAppUserId: () =>
    Purchases.generateRevenueCatAnonymousAppUserId(),
};

function readEnvString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toRevenueCatCustomerInfo(
  info: CustomerInfo | undefined,
): RevenueCatCustomerInfo {
  return {
    activeEntitlementIds: Object.keys(info?.entitlements?.active ?? {}),
  };
}

function toRevenueCatPackage(entry: WebBillingPackage): RevenueCatPackage {
  const product = entry.webBillingProduct;
  return {
    identifier: entry.identifier ?? "",
    productIdentifier: product?.identifier ?? "",
    title: product?.title ?? product?.displayName ?? "",
    description: product?.description ?? "",
    priceString:
      product?.price?.formattedPrice ??
      product?.currentPrice?.formattedPrice ??
      "",
  };
}

async function currentPackages(
  purchases: RevenueCatWebPurchases,
): Promise<readonly WebBillingPackage[]> {
  const offerings = await purchases.getOfferings();
  return offerings?.current?.availablePackages ?? [];
}

/**
 * Runs one SDK purchase. `isolateAbandonedPurchase` is invoked when the
 * caller aborts while the purchase is still unsettled, so the backend can
 * wall the abandoned purchase off from later retries (see
 * {@link createWebRevenueCatBackend}).
 */
async function purchaseOnInstance({
  abortSignal,
  htmlTarget,
  instance,
  isolateAbandonedPurchase,
  metadata,
  packageId,
}: {
  abortSignal?: AbortSignal | undefined;
  htmlTarget?: HTMLElement | undefined;
  instance: RevenueCatWebPurchases;
  isolateAbandonedPurchase: (abandoned: RevenueCatWebPurchases) => void;
  metadata?: Record<string, string> | undefined;
  packageId: string;
}): Promise<RevenueCatCustomerInfo> {
  const throwIfAborted = () => {
    // The caller dismissed the flow while this purchase was still in its
    // pre-checkout phase (offerings fetch etc.). Mounting now would put a
    // checkout on screen that nothing controls — the embedded widget has no
    // provider-side close button — so bail out as a cancellation before the
    // SDK renders anything. PurchaseAbortedError (not the base cancellation)
    // tells callers no checkout UI ever existed.
    if (abortSignal?.aborted) {
      throw new PurchaseAbortedError();
    }
  };

  throwIfAborted();
  let aPackage: WebBillingPackage | undefined;
  try {
    aPackage = (await currentPackages(instance)).find(
      (entry) => entry.identifier === packageId,
    );
  } catch (error) {
    // A pre-mount failure of a purchase the caller already abandoned is not
    // a real outcome — normalize it to the pre-checkout abort the
    // abandonment asked for, so PurchaseAbortedError reliably means "no
    // checkout ever mounted".
    throwIfAborted();
    throw error;
  }
  // Aborted takes precedence over a missing package: an abandoned flow's
  // outcome must stay a pre-mount abort, not a plain error a caller could
  // mistake for a mounted checkout's failure.
  throwIfAborted();
  if (!aPackage) {
    throw new Error(`Unknown purchase package: ${packageId}`);
  }

  let settled = false;
  const onAbort = () => {
    if (!settled) {
      isolateAbandonedPurchase(instance);
    }
  };
  abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await instance.purchase({
      rcPackage: aPackage,
      ...(htmlTarget ? { htmlTarget } : {}),
      ...(metadata ? { metadata } : {}),
    });
    return toRevenueCatCustomerInfo(result.customerInfo);
  } catch (error) {
    // Normalize the provider's cancel signal so the app can treat a dismissed
    // checkout as a no-op instead of a failed purchase.
    if (
      error instanceof PurchasesError &&
      error.errorCode === ErrorCode.UserCancelledError
    ) {
      throw new PurchaseCancelledError();
    }
    throw error;
  } finally {
    settled = true;
    abortSignal?.removeEventListener("abort", onAbort);
  }
}

export function createWebRevenueCatBackend(
  sdk: RevenueCatWebSdk = revenueCatWebSdk,
): RevenueCatBackend {
  let purchases: RevenueCatWebPurchases | null = null;
  let appUserId: string | null = null;
  let apiKey: string | null = null;

  const requirePurchases = (): RevenueCatWebPurchases => {
    if (!purchases) {
      throw new Error("RevenueCat Web Billing is not configured.");
    }
    return purchases;
  };

  const ensurePurchases = ({
    apiKey: nextApiKey,
    appUserId: nextAppUserId,
  }: {
    apiKey: string;
    appUserId?: string | undefined;
  }): RevenueCatWebPurchases => {
    if (purchases) {
      return purchases;
    }

    const configuredAppUserId =
      nextAppUserId ?? sdk.generateRevenueCatAnonymousAppUserId();
    purchases = sdk.configure({
      apiKey: nextApiKey,
      appUserId: configuredAppUserId,
      flags: { collectAnalyticsEvents: false },
    });
    appUserId = configuredAppUserId;
    apiKey = nextApiKey;
    return purchases;
  };

  /**
   * Walls off a purchase that was abandoned while still unsettled. The SDK
   * keeps checkout-session state (`operationSessionId`) on ONE helper shared
   * by every purchase of an instance, so a retry started while the abandoned
   * purchase's checkout-start response is still in flight could have its
   * session clobbered by that late response — completing the retry against
   * the wrong checkout session. Closing the singleton and configuring a fresh
   * instance gives the next purchase its own helper; the abandoned purchase's
   * continuations stay bound to the old, now-isolated instance.
   */
  const isolateAbandonedPurchase = (abandoned: RevenueCatWebPurchases) => {
    if (purchases !== abandoned || apiKey === null) {
      // A newer isolation already replaced the instance; nothing to do.
      return;
    }
    abandoned.close();
    purchases = sdk.configure({
      apiKey,
      appUserId: appUserId ?? sdk.generateRevenueCatAnonymousAppUserId(),
      flags: { collectAnalyticsEvents: false },
    });
  };

  return {
    configure(input) {
      ensurePurchases(input);
      return Promise.resolve();
    },
    async logIn({ appUserId: nextAppUserId }) {
      const instance = requirePurchases();
      if (appUserId === nextAppUserId) {
        return;
      }

      await instance.changeUser(nextAppUserId);
      appUserId = nextAppUserId;
    },
    async logOut() {
      const instance = requirePurchases();
      const anonymousAppUserId = sdk.generateRevenueCatAnonymousAppUserId();
      await instance.changeUser(anonymousAppUserId);
      appUserId = anonymousAppUserId;
    },
    async setAttributes(attributes) {
      await requirePurchases().setAttributes(attributes);
    },
    async getCurrentPackages() {
      return (await currentPackages(requirePurchases())).map(
        toRevenueCatPackage,
      );
    },
    purchasePackage({ abortSignal, htmlTarget, metadata, packageId }) {
      return purchaseOnInstance({
        abortSignal,
        htmlTarget,
        instance: requirePurchases(),
        isolateAbandonedPurchase,
        metadata,
        packageId,
      });
    },
    async getCustomerInfo() {
      return toRevenueCatCustomerInfo(
        await requirePurchases().getCustomerInfo(),
      );
    },
    async restorePurchases() {
      return toRevenueCatCustomerInfo(
        await requirePurchases().getCustomerInfo(),
      );
    },
  };
}

export function createWebPurchases(): PurchasesCapability {
  const apiKey = readEnvString(process.env.BUN_PUBLIC_REVENUECAT_WEB_API_KEY);
  if (!apiKey) {
    return createUnavailablePurchases();
  }

  return createRevenueCatPurchases(createWebRevenueCatBackend(), {
    apiKey,
    nativeStore: null,
    // RevenueCat remains configured so existing entitlements can be observed,
    // but web purchases must use our direct Stripe checkout: only that path
    // selects the server-authoritative fixed tier in Stripe.
    purchasesEnabled: false,
    syncEntitlementId:
      readEnvString(process.env.BUN_PUBLIC_REVENUECAT_SYNC_ENTITLEMENT) ??
      DEFAULT_SYNC_ENTITLEMENT_ID,
  });
}
