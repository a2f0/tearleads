export interface TransportGate {
  /** Resolves when a matching request reaches the gate. */
  readonly entered: Promise<void>;
  release(): void;
  wait(signal: AbortSignal): Promise<void>;
}

/** A request barrier controlled by the test, without timers or sleeps. */
export function createTransportGate(): TransportGate {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    release: () => released.resolve(),
    async wait(signal) {
      entered.resolve();
      signal.throwIfAborted();
      const aborted = Promise.withResolvers<never>();
      const onAbort = () => aborted.reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        await Promise.race([released.promise, aborted.promise]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
