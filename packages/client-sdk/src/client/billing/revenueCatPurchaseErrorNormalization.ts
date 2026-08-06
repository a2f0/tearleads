import {
  PurchaseAbortedError,
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
} from "./purchaseErrors";
import {
  RevenueCatCheckoutAbandonedError,
  RevenueCatCheckoutIdentityPendingError,
  RevenueCatOperationTimeoutError,
} from "./revenueCatErrors";

function throwPurchaseTimeoutError(
  error: RevenueCatOperationTimeoutError,
): never {
  throw error.restartRequired
    ? new PurchaseProviderStalledError(error)
    : new PurchaseIdentityPendingError(error);
}

export function normalizeRevenueCatCheckoutError(error: unknown): never {
  if (error instanceof RevenueCatCheckoutAbandonedError) {
    throw new PurchaseAbortedError();
  }
  if (error instanceof RevenueCatCheckoutIdentityPendingError) {
    throw new PurchaseIdentityPendingError(error);
  }
  if (error instanceof RevenueCatOperationTimeoutError) {
    throwPurchaseTimeoutError(error);
  }
  throw error;
}

export function normalizeRevenueCatIdentityError(error: unknown): never {
  if (error instanceof RevenueCatOperationTimeoutError) {
    throwPurchaseTimeoutError(error);
  }
  throw error;
}
