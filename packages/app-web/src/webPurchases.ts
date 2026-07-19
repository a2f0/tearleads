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

export function createWebRevenueCatBackend(
  sdk: RevenueCatWebSdk = revenueCatWebSdk,
): RevenueCatBackend {
  let purchases: RevenueCatWebPurchases | null = null;
  let appUserId: string | null = null;

  const requirePurchases = (): RevenueCatWebPurchases => {
    if (!purchases) {
      throw new Error("RevenueCat Web Billing is not configured.");
    }
    return purchases;
  };

  const ensurePurchases = ({
    apiKey,
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
    purchases = sdk.configure({ apiKey, appUserId: configuredAppUserId });
    appUserId = configuredAppUserId;
    return purchases;
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
    async purchasePackage({ abortSignal, htmlTarget, metadata, packageId }) {
      const throwIfAborted = () => {
        // The caller dismissed the flow while this purchase was still in its
        // pre-checkout phase (offerings fetch etc.). Mounting now would put a
        // checkout on screen that nothing controls — the embedded widget has
        // no provider-side close button — so bail out as a cancellation
        // before the SDK renders anything.
        if (abortSignal?.aborted) {
          throw new PurchaseCancelledError();
        }
      };

      throwIfAborted();
      const aPackage = (await currentPackages(requirePurchases())).find(
        (entry) => entry.identifier === packageId,
      );
      if (!aPackage) {
        throw new Error(`Unknown purchase package: ${packageId}`);
      }
      // Last chance to stop before purchase() mounts the checkout UI; the SDK
      // has no abort API once it starts.
      throwIfAborted();

      try {
        const result = await requirePurchases().purchase({
          rcPackage: aPackage,
          ...(htmlTarget ? { htmlTarget } : {}),
          ...(metadata ? { metadata } : {}),
        });
        return toRevenueCatCustomerInfo(result.customerInfo);
      } catch (error) {
        // Normalize the provider's cancel signal so the app can treat a
        // dismissed checkout as a no-op instead of a failed purchase.
        if (
          error instanceof PurchasesError &&
          error.errorCode === ErrorCode.UserCancelledError
        ) {
          throw new PurchaseCancelledError();
        }
        throw error;
      }
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
    syncEntitlementId:
      readEnvString(process.env.BUN_PUBLIC_REVENUECAT_SYNC_ENTITLEMENT) ??
      DEFAULT_SYNC_ENTITLEMENT_ID,
  });
}
