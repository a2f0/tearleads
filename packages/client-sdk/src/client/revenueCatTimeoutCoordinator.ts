import {
  copyRevenueCatError,
  type RevenueCatOperationTimeoutError,
  withRevenueCatOperationTimeout,
} from "./revenueCatErrors";

export class RevenueCatTimeoutCoordinator {
  private identityMutationInFlight = false;
  private identityMutationTimeoutError:
    | RevenueCatOperationTimeoutError
    | undefined;
  private pendingIdentityTimeoutError:
    | RevenueCatOperationTimeoutError
    | undefined;
  private pendingProviderTimeoutError:
    | RevenueCatOperationTimeoutError
    | undefined;
  private wedgedIdentityError: RevenueCatOperationTimeoutError | undefined;

  constructor(private readonly timeoutMs: number) {}

  get identityMutationActive(): boolean {
    return this.identityMutationInFlight;
  }

  get hasPendingOperation(): boolean {
    return (
      this.pendingIdentityTimeoutError !== undefined ||
      this.pendingProviderTimeoutError !== undefined
    );
  }

  rejectIfIdentityTimedOut<T>(): Promise<T> | undefined {
    const error =
      this.wedgedIdentityError ??
      this.pendingIdentityTimeoutError ??
      this.pendingProviderTimeoutError;
    return error ? Promise.reject(copyRevenueCatError(error)) : undefined;
  }

  rejectIfProviderTimedOut<T>(
    requiresKnownIdentity: boolean,
  ): Promise<T> | undefined {
    if (this.wedgedIdentityError) {
      return Promise.reject(copyRevenueCatError(this.wedgedIdentityError));
    }
    const pendingError =
      this.pendingIdentityTimeoutError ?? this.pendingProviderTimeoutError;
    return pendingError && requiresKnownIdentity
      ? Promise.reject(copyRevenueCatError(pendingError))
      : undefined;
  }

  rejectIfWedged<T>(): Promise<T> | undefined {
    return this.wedgedIdentityError
      ? Promise.reject(copyRevenueCatError(this.wedgedIdentityError))
      : undefined;
  }

  markWedged(error: RevenueCatOperationTimeoutError): void {
    this.wedgedIdentityError = error;
  }

  clearPendingIdentityTimeout(): void {
    this.pendingIdentityTimeoutError = undefined;
  }

  async runIdentityMutation(operation: () => Promise<void>): Promise<void> {
    this.identityMutationInFlight = true;
    const lateTimeout = this.armLateIdentityMutationTimeout();
    try {
      await operation();
    } finally {
      if (lateTimeout !== undefined) clearTimeout(lateTimeout);
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

  withIdentityChangeTimeout<T>(
    operation: Promise<T>,
    operationName: string,
  ): Promise<T> {
    return this.withTimeout(operation, operationName, (error) => {
      this.pendingIdentityTimeoutError = error;
      if (this.identityMutationInFlight) {
        error.markRestartRequired();
        this.identityMutationTimeoutError = error;
        this.wedgedIdentityError = error;
      }
    });
  }

  withOperationTimeout<T>(
    operation: Promise<T>,
    operationName: string,
  ): Promise<T> {
    return this.withTimeout(operation, operationName);
  }

  armLateProviderTimeout(): ReturnType<typeof setTimeout> | undefined {
    const error = this.pendingProviderTimeoutError;
    if (!error || error.restartRequired) return undefined;
    return setTimeout(() => {
      if (this.pendingProviderTimeoutError !== error) return;
      error.markRestartRequired();
      this.wedgedIdentityError = error;
    }, this.timeoutMs);
  }

  withProviderTimeout<T>(
    operation: Promise<T>,
    operationName: string,
    hasStarted: () => boolean,
    onTimeout?: () => void,
  ): Promise<T> {
    let timeoutError: RevenueCatOperationTimeoutError | undefined;
    const clearWedge = () => {
      if (timeoutError === undefined) return;
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

  private withTimeout<T>(
    operation: Promise<T>,
    operationName: string,
    onTimeout?: (error: RevenueCatOperationTimeoutError) => void,
  ): Promise<T> {
    return withRevenueCatOperationTimeout({
      operation: () => operation,
      operationName,
      ...(onTimeout ? { onTimeout } : {}),
      timeoutMs: this.timeoutMs,
    });
  }

  private armLateIdentityMutationTimeout():
    | ReturnType<typeof setTimeout>
    | undefined {
    const error = this.pendingIdentityTimeoutError;
    if (!error || error.restartRequired) return undefined;
    return setTimeout(() => {
      if (
        this.pendingIdentityTimeoutError !== error ||
        !this.identityMutationInFlight
      ) {
        return;
      }
      error.markRestartRequired();
      this.identityMutationTimeoutError = error;
      this.wedgedIdentityError = error;
    }, this.timeoutMs);
  }
}
