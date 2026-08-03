interface RevenueCatIdentityBackend {
  configure(input: { apiKey: string; appUserId?: string }): Promise<void>;
  logIn(input: { appUserId: string }): Promise<void>;
  logOut(): Promise<void>;
}

export interface RevenueCatProviderOperation<T> {
  /** True for provider flows that may wait on buyer-controlled store UI. */
  readonly buyerPaced?: boolean;
  readonly operation: () => Promise<T>;
  readonly operationName: string;
  /** False only for provider state that is not scoped to a customer. */
  readonly requiresKnownIdentity?: boolean;
  /** Defers store operations until the active native checkout settles. */
  readonly waitForCheckout?: boolean;
}

export interface RevenueCatCustomerMutation {
  readonly operation: () => Promise<void>;
  readonly operationName: string;
}

export interface RevenueCatIdentityCoordinator {
  identify(appUserId: string): Promise<void>;
  reset(): Promise<void>;
  runCustomerMutation(input: RevenueCatCustomerMutation): Promise<void>;
  runProviderOperation<T>(input: RevenueCatProviderOperation<T>): Promise<T>;
  runCheckout<T>(input: {
    readonly abortReleasesIdentityGate?: boolean;
    readonly abortSignal?: AbortSignal;
    readonly operation: () => Promise<T>;
    readonly prepare?: () => Promise<void>;
  }): Promise<T>;
}

export interface RevenueCatIdentityCoordinatorInput {
  readonly apiKey: string;
  readonly backend: RevenueCatIdentityBackend;
  readonly checkoutSettlementTimeoutMs: number;
  readonly timeoutMs: number;
}
