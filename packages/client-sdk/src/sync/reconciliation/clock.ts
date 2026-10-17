/**
 * Time source for the reconciler's own retry and continuation timers. Sync
 * lane timing (failure backoff, delayed requests) belongs to the coordinator
 * the host registers the lane on, not to this clock.
 */
export interface ReconciliationClock {
  readonly now: () => number;
  /** Run `callback` after `delayMs`; the returned function cancels it. */
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
}

export const systemReconciliationClock: ReconciliationClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};
