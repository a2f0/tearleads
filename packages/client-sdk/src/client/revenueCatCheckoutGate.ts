import {
  type RevenueCatOperationTimeoutError,
  withRevenueCatOperationTimeout,
} from "./revenueCatErrors";

interface RevenueCatCheckoutGate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

/** Owns the lifetime gates that keep identity changes behind live checkouts. */
export class RevenueCatCheckoutGateCoordinator {
  private readonly active = new Set<Promise<void>>();

  get hasActive(): boolean {
    return this.active.size > 0;
  }

  afterActive<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.hasActive) return operation();
    const current = Array.from(this.active);
    return Promise.all(current).then(operation);
  }

  reserve(): { gate: RevenueCatCheckoutGate; ready: Promise<void> } {
    const current = Array.from(this.active);
    const gate = this.create(undefined, false, () => {});
    return { gate, ready: Promise.all(current).then(() => undefined) };
  }

  create(
    abortSignal: AbortSignal | undefined,
    releaseOnAbort: boolean,
    markAbandoned: () => void,
  ): RevenueCatCheckoutGate {
    let resolveGate = () => {};
    let released = false;
    const promise = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const onAbort = () => {
      markAbandoned();
      // An isolated Web Billing instance can release immediately. Native store
      // sheets are not cancellable, so their identity gate stays until result.
      if (releaseOnAbort) release();
    };
    const release = () => {
      if (released) return;
      released = true;
      abortSignal?.removeEventListener("abort", onAbort);
      this.active.delete(promise);
      resolveGate();
    };
    this.active.add(promise);
    if (abortSignal?.aborted) {
      onAbort();
    } else {
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    }
    return { promise, release };
  }

  start<T>(
    operation: () => Promise<T>,
    gate: RevenueCatCheckoutGate,
    settlement: {
      readonly onTimeout: (error: RevenueCatOperationTimeoutError) => void;
      readonly timeoutMs: number;
    },
  ): { result: Promise<T> } {
    const providerResult = Promise.resolve().then(operation);
    void providerResult.then(gate.release, gate.release);
    const result = withRevenueCatOperationTimeout({
      operation: () => providerResult,
      operationName: "checkout settlement",
      onTimeout: (error) => {
        error.markRestartRequired();
        gate.release();
        settlement.onTimeout(error);
      },
      timeoutMs: settlement.timeoutMs,
    });
    return { result };
  }
}
