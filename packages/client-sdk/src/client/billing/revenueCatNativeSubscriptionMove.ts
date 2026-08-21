import type { NativeSubscriptionStore } from "@symcrypt/validators/billing";
import { PurchasesUnavailableError } from "./purchaseErrors";
import {
  RevenueCatOperationTimeoutError,
  revenueCatOperationTimeoutMs,
  withRevenueCatOperationTimeout,
} from "./revenueCatErrors";
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
  readonly operationTimeoutMs?: number;
  readonly purchasesEnabled?: boolean;
  readonly restorePurchasesUsesCheckoutTimeout: boolean;
  readonly syncEntitlementId: string;
}

class NativeSubscriptionClaimTimeoutError extends Error {
  readonly code = "native-claim-timeout";

  constructor(cause: RevenueCatOperationTimeoutError) {
    super("Native subscription claim timed out", { cause });
    this.name = "NativeSubscriptionClaimTimeoutError";
  }
}

function normalizeClaimError(error: unknown): never {
  throw error instanceof RevenueCatOperationTimeoutError
    ? new NativeSubscriptionClaimTimeoutError(error)
    : error;
}

/** Restores, server-claims, and binds one receipt without releasing its buyer. */
function moveRevenueCatNativeSubscription(input: {
  readonly attributeKey: string;
  readonly backend: NativeSubscriptionMoveBackend;
  readonly claim: (store: NativeSubscriptionStore) => Promise<boolean>;
  readonly claimTimeoutMs: number;
  readonly entitlementId: string;
  readonly identity: RevenueCatIdentityCoordinator;
  readonly organizationId: string;
  readonly restorePurchasesUsesCheckoutTimeout: boolean;
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
          operationName: "restore",
          ...(input.restorePurchasesUsesCheckoutTimeout
            ? { usesCheckoutSettlementTimeout: true }
            : {}),
        },
      );
      if (
        !Array.isArray(info.activeEntitlementIds) ||
        !info.activeEntitlementIds.includes(input.entitlementId)
      ) {
        throw new Error("The restored receipt has no sync entitlement");
      }
      const claimAccepted = await withRevenueCatOperationTimeout({
        operation: () => input.claim(input.store),
        operationName: "native subscription claim",
        timeoutMs: input.claimTimeoutMs,
      }).catch(normalizeClaimError);
      if (!claimAccepted) {
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
  const claimTimeoutMs = revenueCatOperationTimeoutMs(
    config.operationTimeoutMs,
  );
  return async (request) => {
    if (config.purchasesEnabled === false || !config.nativeStore) {
      throw new PurchasesUnavailableError();
    }
    await moveRevenueCatNativeSubscription({
      attributeKey,
      backend,
      claimTimeoutMs,
      entitlementId: config.syncEntitlementId,
      identity,
      restorePurchasesUsesCheckoutTimeout:
        config.restorePurchasesUsesCheckoutTimeout,
      ...request,
      store: config.nativeStore,
    }).catch(normalizeRevenueCatIdentityError);
  };
}
