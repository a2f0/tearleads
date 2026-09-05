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
import { RevenueCatProviderPhaseCoordinator } from "./revenueCatProviderPhase";
import { settleRevenueCatProviderOperation } from "./revenueCatProviderSettlement";
import { RevenueCatTimeoutCoordinator } from "./revenueCatTimeoutCoordinator";

interface ProviderEnqueueReservation {
  readonly release: () => void;
}

/** Pre-consumed deferred marking the moment provider preflight settles. */
function createPreflightGate() {
  let resolve = () => {};
  let reject = (_error: unknown) => {};
  const promise = new Promise<void>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  void promise.catch(() => undefined);
  return { promise, reject, resolve };
}

class RevenueCatIdentityCoordinatorState
  implements RevenueCatIdentityCoordinator
{
  private configured: Promise<void> | undefined;
  // undefined = unknown persisted identity, null = known anonymous buyer.
  private currentAppUserId: string | null | undefined;
  private retryIdentity: (() => Promise<void>) | undefined;
  private blockedIdentityError: Error | undefined;
  private readonly pendingIdentityChanges = new Set<Promise<void>>();
  private readonly pendingProviderEnqueues = new Set<Promise<void>>();
  private providerTail = Promise.resolve();
  private readonly checkouts = new RevenueCatCheckoutGateCoordinator();
  private readonly timeouts: RevenueCatTimeoutCoordinator;

  constructor(private readonly input: RevenueCatIdentityCoordinatorInput) {
    this.timeouts = new RevenueCatTimeoutCoordinator(
      input.timeoutMs,
      input.checkoutSettlementTimeoutMs,
    );
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
    return this.transitionIdentity(appUserId, "identification");
  }

  reset(): Promise<void> {
    return this.transitionIdentity(null, "reset");
  }

  /** `null` targets the known anonymous buyer via logOut. */
  private transitionIdentity(
    target: string | null,
    operationName: string,
  ): Promise<void> {
    const timedOut = this.timeouts.rejectIfIdentityTimedOut<void>();
    if (timedOut) return timedOut;
    const ready = this.startConfiguration(target ?? undefined);
    if (
      this.pendingIdentityChanges.size === 0 &&
      this.identityIsCurrent(target)
    ) {
      this.blockedIdentityError = undefined;
      return this.timeouts.withOperationTimeout(ready, operationName);
    }
    return this.runIdentityChange(async () => {
      await ready;
      // configure({ appUserId }) already establishes this exact identity.
      if (this.identityIsCurrent(target)) {
        this.blockedIdentityError = undefined;
        return;
      }
      await this.applyIdentityTarget(target);
    }, operationName);
  }

  private identityIsCurrent(target: string | null): boolean {
    return !this.retryIdentity && this.currentAppUserId === target;
  }

  private applyIdentityTarget(target: string | null): Promise<void> {
    const mutation =
      target === null
        ? () => this.input.backend.logOut()
        : () => this.input.backend.logIn({ appUserId: target });
    return this.applyIdentityMutation(mutation, target);
  }

  private async applyIdentityMutation(
    mutation: () => Promise<void>,
    resultingAppUserId: string | null,
  ): Promise<void> {
    this.blockedIdentityError = undefined;
    const apply = async () => {
      await this.timeouts.runIdentityMutation(mutation);
      this.currentAppUserId = resultingAppUserId;
    };
    try {
      await apply();
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
    } catch (error) {
      this.retryIdentity = apply;
      throw error;
    }
  }

  private runIdentityChange(
    operation: () => Promise<void>,
    operationName: string,
  ): Promise<void> {
    const providerEnqueuesBeforeChange = this.providerEnqueuesBeforeNow();
    let resolveCompletion = () => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.pendingIdentityChanges.add(completion);
    const enqueue = () => {
      const timedOut = this.timeouts.rejectIfWedged<void>();
      return timedOut ?? this.enqueueProviderOperation(operation);
    };
    const transition = this.checkouts.afterActive(() =>
      providerEnqueuesBeforeChange
        ? providerEnqueuesBeforeChange.then(enqueue)
        : enqueue(),
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

  private providerEnqueuesBeforeNow(): Promise<void> | undefined {
    if (this.pendingProviderEnqueues.size === 0) return undefined;
    return Promise.all(this.pendingProviderEnqueues).then(() => undefined);
  }

  private reserveProviderEnqueue(): ProviderEnqueueReservation {
    let resolveReservation = () => {};
    const reservation = new Promise<void>((resolve) => {
      resolveReservation = resolve;
    });
    let released = false;
    this.pendingProviderEnqueues.add(reservation);
    return {
      release: () => {
        if (released) return;
        released = true;
        this.pendingProviderEnqueues.delete(reservation);
        resolveReservation();
      },
    };
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

  private scheduleProviderOperation<T>(input: {
    readonly enqueueReservation: ProviderEnqueueReservation | undefined;
    readonly isAbandoned: () => boolean;
    readonly markStarted: () => void;
    readonly providerInput: RevenueCatProviderOperation<T>;
    readonly providerPhase: RevenueCatProviderPhaseCoordinator | undefined;
    readonly ready: Promise<void>;
    readonly rejectPreflight: (error: unknown) => void;
    readonly requiresKnownIdentity: boolean;
    readonly resolvePreflight: () => void;
  }): Promise<T> {
    const wedged = this.timeouts.rejectIfWedged<T>();
    if (wedged) {
      input.enqueueReservation?.release();
      void wedged.catch(input.rejectPreflight);
      return wedged;
    }
    const scheduled = this.enqueueProviderOperation(async () => {
      try {
        await input.ready;
        if (input.providerInput.expectedAppUserId !== undefined) {
          await this.ensureExpectedIdentity(
            input.providerInput.expectedAppUserId,
          );
        } else if (input.requiresKnownIdentity) {
          await this.recoverIdentity();
        }
      } catch (error) {
        input.rejectPreflight(error);
        throw error;
      }
      if (input.isAbandoned()) {
        const error = new RevenueCatCheckoutAbandonedError();
        input.rejectPreflight(error);
        throw error;
      }
      input.markStarted();
      const lateTimeout = this.timeouts.armLateProviderTimeout();
      input.resolvePreflight();
      try {
        return await input.providerInput.operation(input.providerPhase);
      } finally {
        if (lateTimeout !== undefined) clearTimeout(lateTimeout);
      }
    });
    input.enqueueReservation?.release();
    return scheduled;
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
    const providerEnqueuesBeforeOperation = requiresKnownIdentity
      ? this.providerEnqueuesBeforeNow()
      : undefined;
    const enqueueReservation = requiresKnownIdentity
      ? this.reserveProviderEnqueue()
      : undefined;
    const reservation = providerInput.waitForCheckout
      ? this.checkouts.reserve()
      : undefined;
    const providerPhase =
      providerInput.phasedProviderOperations === true
        ? new RevenueCatProviderPhaseCoordinator(this.timeouts)
        : undefined;
    const ready = this.startConfiguration(providerInput.expectedAppUserId);
    let providerStarted = false;
    let abandoned = false;
    const preflight = createPreflightGate();
    const schedule = () =>
      this.scheduleProviderOperation({
        enqueueReservation,
        isAbandoned: () => abandoned,
        markStarted: () => {
          providerStarted = true;
        },
        providerInput,
        providerPhase,
        ready,
        rejectPreflight: preflight.reject,
        requiresKnownIdentity,
        resolvePreflight: preflight.resolve,
      });
    const scheduleAfterIdentity = () => {
      const dependencies: Promise<void>[] = [];
      if (requiresKnownIdentity && identityBeforeOperation) {
        dependencies.push(identityBeforeOperation);
      }
      if (providerEnqueuesBeforeOperation)
        dependencies.push(providerEnqueuesBeforeOperation);
      return dependencies.length > 0
        ? Promise.all(dependencies).then(schedule)
        : schedule();
    };
    const operation = reservation
      ? reservation.ready.then(scheduleAfterIdentity)
      : scheduleAfterIdentity();
    if (reservation)
      void operation.then(reservation.gate.release, reservation.gate.release);
    const abandonPreparation = () => {
      abandoned = true;
      enqueueReservation?.release();
      reservation?.gate.release();
    };
    const abandonProvider = providerInput.waitForCheckout
      ? () => {
          abandoned = true;
          enqueueReservation?.release();
          if (!providerStarted && !this.timeouts.identityMutationActive) {
            reservation?.gate.release();
          }
        }
      : undefined;
    return settleRevenueCatProviderOperation({
      usesCheckoutSettlementTimeout:
        providerInput.usesCheckoutSettlementTimeout === true,
      onPreparationTimeout: abandonPreparation,
      ...(abandonProvider ? { onProviderTimeout: abandonProvider } : {}),
      operation,
      operationName: providerInput.operationName,
      preflight: preflight.promise,
      providerPhase,
      providerStarted: () => providerStarted,
      timeouts: this.timeouts,
    });
  }

  private async ensureExpectedIdentity(appUserId: string): Promise<void> {
    if (this.identityIsCurrent(appUserId)) {
      this.blockedIdentityError = undefined;
      return;
    }
    await this.applyIdentityTarget(appUserId);
  }

  runCheckout<T>(checkoutInput: {
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
        onLateSettlement: (error) => {
          this.timeouts.clearWedge(error);
        },
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
