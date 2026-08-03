/** Thrown when a purchase is attempted without a purchases provider. */
export class PurchasesUnavailableError extends Error {
  constructor(message = "Purchases are not available on this platform") {
    super(message);
    this.name = "PurchasesUnavailableError";
  }
}

/** Buyer dismissed provider checkout without completing the purchase. */
export class PurchaseCancelledError extends Error {
  constructor(message = "The purchase was cancelled") {
    super(message);
    this.name = "PurchaseCancelledError";
  }
}

/** The store account already owns this subscription; offer restore/move. */
export class PurchaseAlreadyOwnedError extends Error {
  constructor(message = "This store account already owns the subscription") {
    super(message);
    this.name = "PurchaseAlreadyOwnedError";
  }
}

/** Checkout was abandoned before any provider UI mounted. */
export class PurchaseAbortedError extends PurchaseCancelledError {
  constructor(message = "The purchase was abandoned before checkout") {
    super(message);
    this.name = "PurchaseAbortedError";
  }
}

/** Checkout could not start because the provider identity is still changing. */
export class PurchaseIdentityPendingError extends Error {
  constructor(cause?: unknown) {
    super("RevenueCat identity or provider queue has not settled", { cause });
    this.name = "PurchaseIdentityPendingError";
  }
}

/** Provider bridge stopped responding; restart the app before retrying. */
export class PurchaseProviderStalledError extends Error {
  constructor(cause?: unknown) {
    super("RevenueCat provider bridge stopped responding", { cause });
    this.name = "PurchaseProviderStalledError";
  }
}
