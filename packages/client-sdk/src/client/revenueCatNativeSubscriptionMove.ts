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
  readonly restorePurchasesBuyerPaced: boolean;
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
  readonly restorePurchasesBuyerPaced: boolean;
  readonly store: NativeSubscriptionStore;
  readonly userId: string;
}): Promise<void> {
  return input.identity.runProviderOperation({
    expectedAppUserId: input.userId,
    operation: async (providerPhase) => {
      if (!providerPhase) {
        throw new Error("Native move requires provider phase control");
      }
      const info = await providerPhase.run(
        () => input.backend.restorePurchases(),
        {
          ...(input.restorePurchasesBuyerPaced ? { buyerPaced: true } : {}),
          operationName: "restore",
        },
      );
      if (
        !Array.isArray(info.activeEntitlementIds) ||
        !info.activeEntitlementIds.includes(input.entitlementId)
      ) {
        throw new Error("The restored receipt has no sync entitlement");
      }
      if (!(await input.claim(input.store))) {
        throw new Error("The server did not accept the native subscription");
      }
      await providerPhase.run(
        () =>
          input.backend.setAttributes({
            [input.attributeKey]: input.organizationId,
          }),
        { operationName: "organization binding" },
      );
    },
    operationName: "native subscription move",
    phasedProviderOperations: true,
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
      restorePurchasesBuyerPaced: config.restorePurchasesBuyerPaced,
      ...request,
      store: config.nativeStore,
    }).catch(normalizeRevenueCatIdentityError);
  };
}
