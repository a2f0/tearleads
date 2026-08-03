import { RevenueCatCheckoutGateCoordinator } from "./revenueCatCheckoutGate";
import {
  copyRevenueCatError,
  normalizeRevenueCatError,
  RevenueCatCheckoutAbandonedError,
  RevenueCatCheckoutIdentityPendingError,
  type RevenueCatOperationTimeoutError,
  withRevenueCatOperationTimeout,
} from "./revenueCatErrors";

export {
  RevenueCatCheckoutAbandonedError,
  RevenueCatCheckoutIdentityPendingError,
  RevenueCatOperationTimeoutError,
  revenueCatOperationTimeoutMs,
} from "./revenueCatErrors";

interface RevenueCatIdentityBackend {
  configure(input: { apiKey: string; appUserId?: string }): Promise<void>;
  logIn(input: { appUserId: string }): Promise<void>;
  logOut(): Promise<void>;
}

interface RevenueCatProviderOperation<T> {
  /** True for provider flows that may wait on buyer-controlled store UI. */
  readonly buyerPaced?: boolean;
  readonly operation: () => Promise<T>;
  readonly operationName: string;
  /** False only for provider state that is not scoped to a customer. */
  readonly requiresKnownIdentity?: boolean;
}

export interface RevenueCatIdentityCoordinator {
  identify(appUserId: string): Promise<void>;
  reset(): Promise<void>;
  runProviderOperation<T>(input: RevenueCatProviderOperation<T>): Promise<T>;
  runCheckout<T>(input: {
    readonly abortSignal?: AbortSignal;
    readonly operation: () => Promise<T>;
    readonly prepare?: () => Promise<void>;
  }): Promise<T>;
}

interface RevenueCatIdentityCoordinatorInput {
  readonly apiKey: string;
  readonly backend: RevenueCatIdentityBackend;
  readonly timeoutMs: number;
}

/**
 * Serializes identity changes and identity-dependent provider operations.
 * Once an identity mutation times out, every provider call fails fast because
 * the single native queue's ownership is unknown until that mutation settles.
 */
class RevenueCatIdentityCoordinatorState
  implements RevenueCatIdentityCoordinator
{
  private configured: Promise<void> | undefined;
  // undefined = unknown persisted identity, null = known anonymous buyer.
  private currentAppUserId: string | null | undefined;
  private retryIdentity: (() => Promise<void>) | undefined;
  private blockedIdentityError: Error | undefined;
  private wedgedIdentityError: Error | undefined;
  private pendingIdentityTimeoutError: Error | undefined;
  private pendingProviderTimeoutError: Error | undefined;
  private identityMutationTimeoutError: Error | undefined;
  private blockingFlowTimeoutError: Error | undefined;
  private buyerPacedInFlight = false;
  private identityMutationInFlight = false;
  private pendingIdentityChanges = 0;
  private identityIdle: Promise<void> | undefined;
  private resolveIdentityIdle: (() => void) | undefined;
  private providerTail = Promise.resolve();
  private readonly checkouts = new RevenueCatCheckoutGateCoordinator();

  constructor(private readonly input: RevenueCatIdentityCoordinatorInput) {}

  private startConfiguration(appUserId?: string): Promise<void> {
    if (this.configured) return this.configured;

    const configureInput =
      appUserId === undefined
        ? { apiKey: this.input.apiKey }
        : { apiKey: this.input.apiKey, appUserId };
    const attempt = Promise.resolve()
      .then(() =>
        this.runIdentityMutation(() =>
          this.input.backend.configure(configureInput),
        ),
      )
      .then(() => {
        // A bare configure can restore a previously persisted identified user.
        // Keep that identity unknown so reset still performs a real logOut.
        this.currentAppUserId = appUserId;
      });
    const cached = attempt.catch((error) => {
      if (this.configured === cached) this.configured = undefined;
      this.currentAppUserId = undefined;
      throw normalizeRevenueCatError(error);
    });
    void cached.catch(() => undefined);
    this.configured = cached;
    return cached;
  }

  private enqueueProviderOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.providerTail.then(operation);
    // The queue tail always settles so one failed operation does not poison all
    // future work. Failed identity changes retain a safe recovery operation.
    this.providerTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async recoverIdentity(): Promise<void> {
    if (this.blockedIdentityError) {
      throw copyRevenueCatError(this.blockedIdentityError);
    }
    const retry = this.retryIdentity;
    if (!retry) return;
    // Recovery is deliberately one-shot. A deterministic provider failure
    // must not be replayed into every later read; the next explicit identify
    // can establish a fresh known identity.
    this.retryIdentity = undefined;
    try {
      await retry();
    } catch (error) {
      this.currentAppUserId = undefined;
      this.blockedIdentityError = normalizeRevenueCatError(error);
      throw this.blockedIdentityError;
    }
  }

  identify(appUserId: string): Promise<void> {
    const timedOut = this.rejectIfIdentityTimedOut<void>();
    if (timedOut) return timedOut;
    const ready = this.startConfiguration(appUserId);
    if (
      this.pendingIdentityChanges === 0 &&
      !this.retryIdentity &&
      this.currentAppUserId === appUserId
    ) {
      this.blockedIdentityError = undefined;
      return this.withTimeout(ready, "identification");
    }
    return this.runIdentityChange(async () => {
      await ready;
      // configure({ appUserId }) already establishes this exact identity.
      if (!this.retryIdentity && this.currentAppUserId === appUserId) {
        this.blockedIdentityError = undefined;
        return;
      }
      await this.logIn(appUserId);
    }, "identification");
  }

  private async logIn(appUserId: string): Promise<void> {
    this.blockedIdentityError = undefined;
    try {
      await this.runIdentityMutation(() =>
        this.input.backend.logIn({ appUserId }),
      );
      this.currentAppUserId = appUserId;
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
    } catch (error) {
      this.retryIdentity = async () => {
        await this.runIdentityMutation(() =>
          this.input.backend.logIn({ appUserId }),
        );
        this.currentAppUserId = appUserId;
      };
      throw error;
    }
  }

  reset(): Promise<void> {
    const timedOut = this.rejectIfIdentityTimedOut<void>();
    if (timedOut) return timedOut;
    const ready = this.startConfiguration();
    if (
      this.pendingIdentityChanges === 0 &&
      !this.retryIdentity &&
      this.currentAppUserId === null
    ) {
      this.blockedIdentityError = undefined;
      return this.withTimeout(ready, "reset");
    }
    return this.runIdentityChange(async () => {
      await ready;
      if (!this.retryIdentity && this.currentAppUserId === null) {
        this.blockedIdentityError = undefined;
        return;
      }
      await this.logOut();
    }, "reset");
  }

  private async logOut(): Promise<void> {
    this.blockedIdentityError = undefined;
    try {
      await this.runIdentityMutation(() => this.input.backend.logOut());
      this.currentAppUserId = null;
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
    } catch (error) {
      this.retryIdentity = async () => {
        await this.runIdentityMutation(() => this.input.backend.logOut());
        this.currentAppUserId = null;
      };
      throw error;
    }
  }

  private async runIdentityMutation(
    operation: () => Promise<void>,
  ): Promise<void> {
    this.identityMutationInFlight = true;
    try {
      await operation();
    } finally {
      this.identityMutationInFlight = false;
      if (
        this.identityMutationTimeoutError !== undefined &&
        this.wedgedIdentityError === this.identityMutationTimeoutError
      ) {
        this.wedgedIdentityError = undefined;
      }
      this.identityMutationTimeoutError = undefined;
    }
  }

  private runIdentityChange(
    operation: () => Promise<void>,
    operationName: string,
  ): Promise<void> {
    if (this.pendingIdentityChanges === 0) {
      this.identityIdle = new Promise<void>((resolve) => {
        this.resolveIdentityIdle = resolve;
      });
    }
    this.pendingIdentityChanges += 1;
    const transition = this.checkouts.afterActive(() =>
      this.enqueueProviderOperation(operation),
    );
    const settled = transition.then(
      () => {
        this.finishIdentityChange();
      },
      (error) => {
        this.finishIdentityChange();
        throw normalizeRevenueCatError(error);
      },
    );
    return this.withTimeout(settled, operationName, (error) => {
      this.pendingIdentityTimeoutError = error;
      if (this.identityMutationInFlight) {
        error.markRestartRequired();
        this.identityMutationTimeoutError = error;
        this.wedgedIdentityError = error;
      } else if (this.checkouts.hasActive || this.buyerPacedInFlight) {
        error.markRestartRequired();
        this.blockingFlowTimeoutError = error;
        this.wedgedIdentityError = error;
      }
    });
  }

  private finishIdentityChange(): void {
    this.pendingIdentityChanges -= 1;
    if (this.pendingIdentityChanges !== 0) return;
    if (this.wedgedIdentityError === this.blockingFlowTimeoutError) {
      this.wedgedIdentityError = undefined;
    }
    this.blockingFlowTimeoutError = undefined;
    this.pendingIdentityTimeoutError = undefined;
    this.resolveIdentityIdle?.();
    this.identityIdle = undefined;
    this.resolveIdentityIdle = undefined;
  }

  runProviderOperation<T>(
    providerInput: RevenueCatProviderOperation<T>,
  ): Promise<T> {
    const requiresKnownIdentity = providerInput.requiresKnownIdentity !== false;
    if (this.wedgedIdentityError) {
      return Promise.reject(copyRevenueCatError(this.wedgedIdentityError));
    }
    const pendingError =
      this.pendingIdentityTimeoutError ?? this.pendingProviderTimeoutError;
    if (pendingError && requiresKnownIdentity) {
      return Promise.reject(copyRevenueCatError(pendingError));
    }
    const ready = this.startConfiguration();
    let providerStarted = false;
    let abandoned = false;
    let resolvePreflight = () => {};
    let rejectPreflight = (_error: unknown) => {};
    const preflight = new Promise<void>((resolve, reject) => {
      resolvePreflight = resolve;
      rejectPreflight = reject;
    });
    void preflight.catch(() => undefined);
    const schedule = () =>
      this.enqueueProviderOperation(async () => {
        try {
          await ready;
          if (requiresKnownIdentity) await this.recoverIdentity();
        } catch (error) {
          rejectPreflight(error);
          throw error;
        }
        if (abandoned) {
          const error = new RevenueCatCheckoutAbandonedError();
          rejectPreflight(error);
          throw error;
        }
        providerStarted = true;
        if (providerInput.buyerPaced) this.buyerPacedInFlight = true;
        resolvePreflight();
        try {
          return await providerInput.operation();
        } finally {
          if (providerInput.buyerPaced) this.buyerPacedInFlight = false;
        }
      });
    const operation =
      requiresKnownIdentity && this.identityIdle
        ? this.identityIdle.then(schedule)
        : schedule();
    if (providerInput.buyerPaced) {
      void operation.catch(() => undefined);
      return this.withProviderTimeout(
        preflight,
        `${providerInput.operationName} preparation`,
        () => this.identityMutationInFlight,
        () => {
          abandoned = true;
        },
      ).then(() => operation);
    }
    return this.withProviderTimeout(
      operation,
      providerInput.operationName,
      () =>
        providerStarted ||
        this.identityMutationInFlight ||
        this.buyerPacedInFlight,
    );
  }

  runCheckout<T>(checkoutInput: {
    readonly abortSignal?: AbortSignal;
    readonly operation: () => Promise<T>;
    readonly prepare?: () => Promise<void>;
  }): Promise<T> {
    if (this.wedgedIdentityError) {
      return Promise.reject(copyRevenueCatError(this.wedgedIdentityError));
    }
    if (
      this.pendingIdentityTimeoutError ||
      this.pendingProviderTimeoutError ||
      this.identityIdle
    ) {
      return Promise.reject(new RevenueCatCheckoutIdentityPendingError());
    }
    const ready = this.startConfiguration();
    let abandoned = checkoutInput.abortSignal?.aborted ?? false;
    const gate = this.checkouts.create(checkoutInput.abortSignal, () => {
      abandoned = true;
      void ready.catch(() => undefined);
    });
    const abandon = () => {
      abandoned = true;
      gate.release();
    };
    let providerPreparationStarted = false;
    const registration = this.enqueueProviderOperation(async () => {
      if (abandoned) throw new RevenueCatCheckoutAbandonedError();
      await ready;
      await this.recoverIdentity();
      if (abandoned) throw new RevenueCatCheckoutAbandonedError();
      providerPreparationStarted = true;
      await checkoutInput.prepare?.();
      if (abandoned) throw new RevenueCatCheckoutAbandonedError();
      return this.checkouts.start(checkoutInput.operation, gate);
    });
    const prepared = this.withProviderTimeout(
      registration,
      "checkout preparation",
      () => providerPreparationStarted || this.buyerPacedInFlight,
      abandon,
    ).catch((error) => {
      abandon();
      throw error;
    });
    return prepared.then(({ result }) => result);
  }

  private withTimeout<T>(
    operation: Promise<T>,
    operationName: string,
    onTimeout?: (error: RevenueCatOperationTimeoutError) => void,
  ): Promise<T> {
    return withRevenueCatOperationTimeout({
      operation: () => operation,
      operationName,
      ...(onTimeout ? { onTimeout } : {}),
      timeoutMs: this.input.timeoutMs,
    });
  }

  private withProviderTimeout<T>(
    operation: Promise<T>,
    operationName: string,
    hasStarted: () => boolean,
    onTimeout?: () => void,
  ): Promise<T> {
    let timeoutError: RevenueCatOperationTimeoutError | undefined;
    const clearWedge = () => {
      if (this.wedgedIdentityError === timeoutError) {
        this.wedgedIdentityError = undefined;
      }
      if (this.pendingProviderTimeoutError === timeoutError) {
        this.pendingProviderTimeoutError = undefined;
      }
    };
    void operation.then(clearWedge, clearWedge);
    return this.withTimeout(operation, operationName, (error) => {
      timeoutError = error;
      if (hasStarted()) {
        error.markRestartRequired();
        this.wedgedIdentityError = error;
      } else {
        this.pendingProviderTimeoutError = error;
      }
      onTimeout?.();
    });
  }

  private rejectIfIdentityTimedOut<T>(): Promise<T> | undefined {
    const error =
      this.wedgedIdentityError ??
      this.pendingIdentityTimeoutError ??
      this.pendingProviderTimeoutError;
    return error ? Promise.reject(copyRevenueCatError(error)) : undefined;
  }
}

export function createRevenueCatIdentityCoordinator(
  input: RevenueCatIdentityCoordinatorInput,
): RevenueCatIdentityCoordinator {
  return new RevenueCatIdentityCoordinatorState(input);
}
