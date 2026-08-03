export interface RevenueCatIdentityBackend {
  configure(input: { apiKey: string; appUserId?: string }): Promise<void>;
  logIn(input: { appUserId: string }): Promise<void>;
  logOut(): Promise<void>;
}

const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;

export function revenueCatOperationTimeoutMs(
  configuredTimeoutMs: number | undefined,
): number {
  const timeoutMs = configuredTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("RevenueCat operation timeout must be positive");
  }
  return timeoutMs;
}

export function withRevenueCatOperationTimeout<T>(input: {
  readonly operation: () => Promise<T>;
  readonly operationName: string;
  readonly onTimeout?: () => void;
  readonly timeoutMs: number;
}): Promise<T> {
  // The native bridge exposes no cancellation primitive. The deadline releases
  // this caller, while the underlying operation remains owned by the identity
  // queue so a retry cannot start a conflicting provider mutation.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      input.onTimeout?.();
      reject(
        new Error(
          `RevenueCat ${input.operationName} timed out after ${input.timeoutMs}ms`,
        ),
      );
    }, input.timeoutMs);
  });
  return Promise.race([
    Promise.resolve().then(input.operation),
    deadline,
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

interface RevenueCatProviderOperation<T> {
  readonly operation: () => Promise<T>;
  readonly operationName: string;
  /** False only for provider state that is not scoped to a customer. */
  readonly requiresKnownIdentity?: boolean;
}

interface RevenueCatIdentityCoordinator {
  identify(appUserId: string): Promise<void>;
  reset(): Promise<void>;
  runProviderOperation<T>(input: RevenueCatProviderOperation<T>): Promise<T>;
  runCheckout<T>(input: {
    readonly abortSignal?: AbortSignal;
    readonly operation: () => Promise<T>;
  }): Promise<T>;
}

interface RevenueCatIdentityCoordinatorInput {
  readonly apiKey: string;
  readonly backend: RevenueCatIdentityBackend;
  readonly timeoutMs: number;
}

interface RevenueCatCheckoutGate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

/** Serializes identity changes and identity-dependent provider operations. */
class RevenueCatIdentityCoordinatorState
  implements RevenueCatIdentityCoordinator
{
  private configured: Promise<void> | undefined;
  // undefined = unknown persisted identity, null = known anonymous buyer.
  private currentAppUserId: string | null | undefined;
  private retryIdentity: (() => Promise<void>) | undefined;
  private blockedIdentityError: Error | undefined;
  private pendingIdentityChanges = 0;
  private identityIdle: Promise<void> | undefined;
  private resolveIdentityIdle: (() => void) | undefined;
  private providerTail = Promise.resolve();
  private readonly activeCheckouts = new Set<Promise<void>>();

  constructor(private readonly input: RevenueCatIdentityCoordinatorInput) {}

  private startConfiguration(appUserId?: string): Promise<void> {
    if (this.configured) return this.configured;

    const configureInput =
      appUserId === undefined
        ? { apiKey: this.input.apiKey }
        : { apiKey: this.input.apiKey, appUserId };
    const attempt = Promise.resolve()
      .then(() => this.input.backend.configure(configureInput))
      .then(() => {
        // A bare configure can restore a previously persisted identified user.
        // Keep that identity unknown so reset still performs a real logOut.
        this.currentAppUserId = appUserId;
      });
    const cached = attempt.catch((error) => {
      if (this.configured === cached) this.configured = undefined;
      this.currentAppUserId = undefined;
      throw error;
    });
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
    if (this.blockedIdentityError) throw this.blockedIdentityError;
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
      this.blockedIdentityError =
        error instanceof Error
          ? error
          : new Error("RevenueCat identity recovery failed");
      throw this.blockedIdentityError;
    }
  }

  identify(appUserId: string): Promise<void> {
    const ready = this.startConfiguration(appUserId);
    if (
      this.pendingIdentityChanges === 0 &&
      this.currentAppUserId === appUserId
    ) {
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
      return this.withTimeout(ready, "identification");
    }
    return this.runIdentityChange(async () => {
      await ready;
      // configure({ appUserId }) already establishes this exact identity.
      if (this.currentAppUserId === appUserId) {
        this.retryIdentity = undefined;
        this.blockedIdentityError = undefined;
        return;
      }
      await this.logIn(appUserId);
    }, "identification");
  }

  private async logIn(appUserId: string): Promise<void> {
    this.blockedIdentityError = undefined;
    try {
      await this.input.backend.logIn({ appUserId });
      this.currentAppUserId = appUserId;
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
    } catch (error) {
      this.retryIdentity = async () => {
        await this.input.backend.logIn({ appUserId });
        this.currentAppUserId = appUserId;
      };
      throw error;
    }
  }

  reset(): Promise<void> {
    const ready = this.startConfiguration();
    if (this.pendingIdentityChanges === 0 && this.currentAppUserId === null) {
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
      return this.withTimeout(ready, "reset");
    }
    return this.runIdentityChange(async () => {
      await ready;
      if (this.currentAppUserId === null) {
        this.retryIdentity = undefined;
        this.blockedIdentityError = undefined;
        return;
      }
      await this.logOut();
    }, "reset");
  }

  private async logOut(): Promise<void> {
    this.blockedIdentityError = undefined;
    try {
      await this.input.backend.logOut();
      this.currentAppUserId = null;
      this.retryIdentity = undefined;
      this.blockedIdentityError = undefined;
    } catch (error) {
      this.retryIdentity = async () => {
        await this.input.backend.logOut();
        this.currentAppUserId = null;
      };
      throw error;
    }
  }

  private afterActiveCheckouts<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeCheckouts.size === 0) return operation();
    const active = Array.from(this.activeCheckouts);
    return Promise.all(active).then(() => this.afterActiveCheckouts(operation));
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
    const transition = this.afterActiveCheckouts(() =>
      this.enqueueProviderOperation(operation),
    );
    const settled = transition.then(
      () => {
        this.finishIdentityChange();
      },
      (error) => {
        this.finishIdentityChange();
        throw error;
      },
    );
    return this.withTimeout(settled, operationName);
  }

  private finishIdentityChange(): void {
    this.pendingIdentityChanges -= 1;
    if (this.pendingIdentityChanges !== 0) return;
    this.resolveIdentityIdle?.();
    this.identityIdle = undefined;
    this.resolveIdentityIdle = undefined;
  }

  runProviderOperation<T>(
    providerInput: RevenueCatProviderOperation<T>,
  ): Promise<T> {
    const ready = this.startConfiguration();
    const requiresKnownIdentity = providerInput.requiresKnownIdentity !== false;
    const schedule = () =>
      this.enqueueProviderOperation(async () => {
        await ready;
        if (requiresKnownIdentity) await this.recoverIdentity();
        return providerInput.operation();
      });
    const operation =
      requiresKnownIdentity && this.identityIdle
        ? this.identityIdle.then(schedule)
        : schedule();
    return this.withTimeout(operation, providerInput.operationName);
  }

  runCheckout<T>(checkoutInput: {
    readonly abortSignal?: AbortSignal;
    readonly operation: () => Promise<T>;
  }): Promise<T> {
    const ready = this.startConfiguration();
    const gate = this.createCheckoutGate(checkoutInput.abortSignal);
    let abandoned = false;
    const abandon = () => {
      abandoned = true;
      gate.release();
    };
    const registration = this.enqueueProviderOperation(async () => {
      await ready;
      await this.recoverIdentity();
      if (abandoned) {
        throw new Error("RevenueCat checkout preparation was abandoned");
      }
      return this.startCheckout(checkoutInput.operation, gate);
    });
    const prepared = this.withTimeout(
      registration,
      "checkout preparation",
      abandon,
    ).catch((error) => {
      abandon();
      throw error;
    });
    return prepared.then(({ result }) => result);
  }

  private createCheckoutGate(
    abortSignal: AbortSignal | undefined,
  ): RevenueCatCheckoutGate {
    let resolveGate = () => {};
    let released = false;
    const promise = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const release = () => {
      if (released) return;
      released = true;
      abortSignal?.removeEventListener("abort", release);
      this.activeCheckouts.delete(promise);
      resolveGate();
    };
    this.activeCheckouts.add(promise);
    if (abortSignal?.aborted) {
      release();
    } else {
      abortSignal?.addEventListener("abort", release, { once: true });
    }
    return { promise, release };
  }

  private startCheckout<T>(
    operation: () => Promise<T>,
    gate: RevenueCatCheckoutGate,
  ): {
    result: Promise<T>;
  } {
    const result = Promise.resolve().then(operation);
    void result.then(gate.release, gate.release);
    return { result };
  }

  private withTimeout<T>(
    operation: Promise<T>,
    operationName: string,
    onTimeout?: () => void,
  ): Promise<T> {
    return withRevenueCatOperationTimeout({
      operation: () => operation,
      operationName,
      ...(onTimeout ? { onTimeout } : {}),
      timeoutMs: this.input.timeoutMs,
    });
  }
}

export function createRevenueCatIdentityCoordinator(
  input: RevenueCatIdentityCoordinatorInput,
): RevenueCatIdentityCoordinator {
  return new RevenueCatIdentityCoordinatorState(input);
}
