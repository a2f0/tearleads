import { RevenueCatCheckoutGateCoordinator } from "./revenueCatCheckoutGate";
import {
  copyRevenueCatError,
  normalizeRevenueCatError,
  RevenueCatCheckoutAbandonedError,
  RevenueCatCheckoutIdentityPendingError,
} from "./revenueCatErrors";
import type {
  RevenueCatCustomerMutation,
  RevenueCatIdentityCoordinator,
  RevenueCatIdentityCoordinatorInput,
  RevenueCatProviderOperation,
} from "./revenueCatIdentityTypes";
import { RevenueCatTimeoutCoordinator } from "./revenueCatTimeoutCoordinator";

export {
  RevenueCatCheckoutAbandonedError,
  RevenueCatCheckoutIdentityPendingError,
  RevenueCatOperationTimeoutError,
  revenueCatCheckoutSettlementTimeoutMs,
  revenueCatOperationTimeoutMs,
} from "./revenueCatErrors";
export type { RevenueCatIdentityCoordinator } from "./revenueCatIdentityTypes";

class RevenueCatIdentityCoordinatorState
  implements RevenueCatIdentityCoordinator
{
  private configured: Promise<void> | undefined;
  // undefined = unknown persisted identity, null = known anonymous buyer.
  private currentAppUserId: string | null | undefined;
  private retryIdentity: (() => Promise<void>) | undefined;
  private blockedIdentityError: Error | undefined;
  private readonly pendingIdentityChanges = new Set<Promise<void>>();
  private providerTail = Promise.resolve();
  private readonly checkouts = new RevenueCatCheckoutGateCoordinator();
  private readonly timeouts: RevenueCatTimeoutCoordinator;

  constructor(private readonly input: RevenueCatIdentityCoordinatorInput) {
    this.timeouts = new RevenueCatTimeoutCoordinator(input.timeoutMs);
  }

  private startConfiguration(appUserId?: string): Promise<void> {
    if (this.configured) return this.configured;

    const configureInput =
      appUserId === undefined
        ? { apiKey: this.input.apiKey }
        : { apiKey: this.input.apiKey, appUserId };
    const attempt = Promise.resolve()
      .then(() =>
        this.timeouts.runIdentityMutation(() =>
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
    const timedOut = this.timeouts.rejectIfIdentityTimedOut<void>();
    if (timedOut) return timedOut;
    const ready = this.startConfiguration(appUserId);
    if (
      this.pendingIdentityChanges.size === 0 &&
      !this.retryIdentity &&
      this.currentAppUserId === appUserId
    ) {
      this.blockedIdentityError = undefined;
      return this.timeouts.withOperationTimeout(ready, "identification");
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
      await this.timeouts.runIdentityMutation(() =>
        this.input.backend.logIn({ appUserId }),
      );
      this.currentAppUserId = appUserId;
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
    } catch (error) {
      this.retryIdentity = async () => {
        await this.timeouts.runIdentityMutation(() =>
          this.input.backend.logIn({ appUserId }),
        );
        this.currentAppUserId = appUserId;
      };
      throw error;
    }
  }

  reset(): Promise<void> {
    const timedOut = this.timeouts.rejectIfIdentityTimedOut<void>();
    if (timedOut) return timedOut;
    const ready = this.startConfiguration();
    if (
      this.pendingIdentityChanges.size === 0 &&
      !this.retryIdentity &&
      this.currentAppUserId === null
    ) {
      this.blockedIdentityError = undefined;
      return this.timeouts.withOperationTimeout(ready, "reset");
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
      await this.timeouts.runIdentityMutation(() =>
        this.input.backend.logOut(),
      );
      this.currentAppUserId = null;
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
    } catch (error) {
      this.retryIdentity = async () => {
        await this.timeouts.runIdentityMutation(() =>
          this.input.backend.logOut(),
        );
        this.currentAppUserId = null;
      };
      throw error;
    }
  }

  private runIdentityChange(
    operation: () => Promise<void>,
    operationName: string,
  ): Promise<void> {
    let resolveCompletion = () => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.pendingIdentityChanges.add(completion);
    const transition = this.checkouts.afterActive(() =>
      this.enqueueProviderOperation(operation),
    );
    const settled = transition.then(
      () => {
        this.finishIdentityChange(completion, resolveCompletion);
      },
      (error) => {
        this.finishIdentityChange(completion, resolveCompletion);
        throw normalizeRevenueCatError(error);
      },
    );
    return this.timeouts.withIdentityChangeTimeout(settled, operationName);
  }

  private finishIdentityChange(
    completion: Promise<void>,
    resolveCompletion: () => void,
  ): void {
    this.pendingIdentityChanges.delete(completion);
    if (this.pendingIdentityChanges.size === 0) {
      this.timeouts.clearPendingIdentityTimeout();
    }
    resolveCompletion();
  }

  private identityChangesBeforeNow(): Promise<void> | undefined {
    if (this.pendingIdentityChanges.size === 0) return undefined;
    return Promise.all(this.pendingIdentityChanges).then(() => undefined);
  }

  runCustomerMutation(input: RevenueCatCustomerMutation): Promise<void> {
    const timedOut = this.timeouts.rejectIfIdentityTimedOut<void>();
    if (timedOut) return timedOut;
    const ready = this.startConfiguration();
    return this.runIdentityChange(async () => {
      await ready;
      await this.recoverIdentity();
      await this.timeouts.runIdentityMutation(input.operation);
    }, input.operationName);
  }

  runProviderOperation<T>(
    providerInput: RevenueCatProviderOperation<T>,
  ): Promise<T> {
    const requiresKnownIdentity = providerInput.requiresKnownIdentity !== false;
    const timedOut = this.timeouts.rejectIfProviderTimedOut<T>(
      requiresKnownIdentity,
    );
    if (timedOut) return timedOut;
    const identityBeforeOperation = this.identityChangesBeforeNow();
    const reservation = providerInput.waitForCheckout
      ? this.checkouts.reserve()
      : undefined;
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
        const lateTimeout = this.timeouts.armLateProviderTimeout();
        resolvePreflight();
        try {
          return await providerInput.operation();
        } finally {
          if (lateTimeout !== undefined) clearTimeout(lateTimeout);
        }
      });
    const scheduleAfterIdentity = () =>
      requiresKnownIdentity && identityBeforeOperation
        ? identityBeforeOperation.then(schedule)
        : schedule();
    const operation = reservation
      ? reservation.ready.then(scheduleAfterIdentity)
      : scheduleAfterIdentity();
    if (reservation) {
      void operation.then(reservation.gate.release, reservation.gate.release);
    }
    if (providerInput.buyerPaced) {
      void operation.catch(() => undefined);
      return this.timeouts
        .withProviderTimeout(
          preflight,
          `${providerInput.operationName} preparation`,
          () => this.timeouts.identityMutationActive,
          () => {
            abandoned = true;
            reservation?.gate.release();
          },
        )
        .then(() => operation);
    }
    return this.timeouts.withProviderTimeout(
      operation,
      providerInput.operationName,
      () => providerStarted || this.timeouts.identityMutationActive,
      providerInput.waitForCheckout
        ? () => {
            abandoned = true;
            if (!providerStarted && !this.timeouts.identityMutationActive) {
              reservation?.gate.release();
            }
          }
        : undefined,
    );
  }

  runCheckout<T>(checkoutInput: {
    readonly abortReleasesIdentityGate?: boolean;
    readonly abortSignal?: AbortSignal;
    readonly operation: () => Promise<T>;
    readonly prepare?: () => Promise<void>;
  }): Promise<T> {
    const timedOut = this.timeouts.rejectIfWedged<T>();
    if (timedOut) return timedOut;
    if (
      this.timeouts.hasPendingOperation ||
      this.pendingIdentityChanges.size > 0
    ) {
      return Promise.reject(new RevenueCatCheckoutIdentityPendingError());
    }
    if (this.checkouts.hasActive) {
      return Promise.reject(new RevenueCatCheckoutIdentityPendingError());
    }
    const ready = this.startConfiguration();
    let abandoned = checkoutInput.abortSignal?.aborted ?? false;
    const gate = this.checkouts.create(
      checkoutInput.abortSignal,
      checkoutInput.abortReleasesIdentityGate === true,
      () => {
        abandoned = true;
        void ready.catch(() => undefined);
      },
    );
    const abandon = () => {
      abandoned = true;
      gate.release();
    };
    let providerPreparationStarted = false;
    const registration = this.enqueueProviderOperation(async () => {
      if (abandoned) throw new RevenueCatCheckoutAbandonedError();
      try {
        await ready;
        await this.recoverIdentity();
      } catch (error) {
        if (!abandoned) throw error;
      }
      if (abandoned) throw new RevenueCatCheckoutAbandonedError();
      providerPreparationStarted = true;
      await checkoutInput.prepare?.();
      if (abandoned) throw new RevenueCatCheckoutAbandonedError();
      return this.checkouts.start(checkoutInput.operation, gate, {
        onTimeout: (error) => {
          this.timeouts.markWedged(error);
        },
        timeoutMs: this.input.checkoutSettlementTimeoutMs,
      });
    });
    const prepared = this.timeouts
      .withProviderTimeout(
        registration,
        "checkout preparation",
        () =>
          providerPreparationStarted || this.timeouts.identityMutationActive,
        abandon,
      )
      .catch((error) => {
        abandon();
        throw error;
      });
    return prepared.then(({ result }) => result);
  }
}

export function createRevenueCatIdentityCoordinator(
  input: RevenueCatIdentityCoordinatorInput,
): RevenueCatIdentityCoordinator {
  return new RevenueCatIdentityCoordinatorState(input);
}
