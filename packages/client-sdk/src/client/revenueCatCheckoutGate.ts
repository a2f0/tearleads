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
    return Promise.all(current).then(() => this.afterActive(operation));
  }

  create(
    abortSignal: AbortSignal | undefined,
    markAbandoned: () => void,
  ): RevenueCatCheckoutGate {
    let resolveGate = () => {};
    let released = false;
    const promise = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const onAbort = () => {
      markAbandoned();
      release();
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
  ): { result: Promise<T> } {
    const result = Promise.resolve().then(operation);
    void result.then(gate.release, gate.release);
    return { result };
  }
}
