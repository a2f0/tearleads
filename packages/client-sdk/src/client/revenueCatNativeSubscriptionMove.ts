import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import { PurchasesUnavailableError } from "./purchaseErrors";
import type { RevenueCatIdentityCoordinator } from "./revenueCatIdentityTypes";
import { normalizeRevenueCatIdentityError } from "./revenueCatPurchaseErrorNormalization";

interface NativeSubscriptionMoveBackend {
  restorePurchases(): Promise<{
    readonly activeEntitlementIds: ReadonlyArray<string>;
  }>;
  setAttributes(attributes: Record<string, string | null>): Promise<void>;
}

interface NativeSubscriptionMoveConfig {
  readonly nativeStore: NativeSubscriptionStore | null;
  readonly purchasesEnabled?: boolean;
  readonly syncEntitlementId: string;
}

/** Restores, server-claims, and binds one receipt without releasing its buyer. */
function moveRevenueCatNativeSubscription(input: {
  readonly attributeKey: string;
  readonly backend: NativeSubscriptionMoveBackend;
  readonly claim: (store: NativeSubscriptionStore) => Promise<boolean>;
  readonly entitlementId: string;
  readonly identity: RevenueCatIdentityCoordinator;
  readonly organizationId: string;
  readonly store: NativeSubscriptionStore;
  readonly userId: string;
}): Promise<void> {
  return input.identity.runProviderOperation({
    buyerPaced: true,
    expectedAppUserId: input.userId,
    operation: async () => {
      const info = await input.backend.restorePurchases();
      if (
        !Array.isArray(info.activeEntitlementIds) ||
        !info.activeEntitlementIds.includes(input.entitlementId)
      ) {
        throw new Error("The restored receipt has no sync entitlement");
      }
      if (!(await input.claim(input.store))) {
        throw new Error("The server did not accept the native subscription");
      }
      await input.backend.setAttributes({
        [input.attributeKey]: input.organizationId,
      });
    },
    operationName: "native subscription move",
    waitForCheckout: true,
  });
}

export function nativeMove(
  backend: NativeSubscriptionMoveBackend,
  config: NativeSubscriptionMoveConfig,
  identity: RevenueCatIdentityCoordinator,
  attributeKey: string,
): (request: {
  readonly claim: (store: NativeSubscriptionStore) => Promise<boolean>;
  readonly organizationId: string;
  readonly userId: string;
}) => Promise<void> {
  return async (request) => {
    if (config.purchasesEnabled === false || !config.nativeStore) {
      throw new PurchasesUnavailableError();
    }
    await moveRevenueCatNativeSubscription({
      attributeKey,
      backend,
      entitlementId: config.syncEntitlementId,
      identity,
      ...request,
      store: config.nativeStore,
    }).catch(normalizeRevenueCatIdentityError);
  };
}
