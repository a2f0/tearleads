import { useEffect } from "react";

/**
 * Backoff schedule (ms) for re-reading server billing after a successful
 * purchase. The client-side purchase resolves immediately, but the RevenueCat
 * webhook that flips this org's `organization_billing` row to active lands a
 * beat later — so a single post-purchase refresh usually still reports the old
 * status. We re-read a few times on this schedule until the billing snapshot
 * reports an upgrade as effective or a downgrade as scheduled; if it never
 * does, the schedule is exhausted and the caller releases the in-flight state.
 */
export const ACTIVATION_POLL_DELAYS_MS: readonly number[] = [
  1000, 2000, 3000, 5000, 8000,
];

/**
 * While an org's activation is pending (a purchase resolved but the server
 * billing row has not reflected the purchase yet), re-read billing on a backoff
 * schedule so the panel reflects the purchase without a manual refresh. The
 * effect stops when the expected tier is effective (or a downgrade is pending),
 * or when the pending flag is reset by a scope change. `delaysMs` is injectable
 * so tests can drive it without real timers; production uses
 * {@link ACTIVATION_POLL_DELAYS_MS}.
 */
export function useActivationBillingPoll(
  activationPending: boolean,
  billingUpdateSettled: boolean,
  refresh: () => Promise<void>,
  delaysMs: readonly number[],
  onExhausted: () => void,
): void {
  useEffect(() => {
    if (!activationPending || billingUpdateSettled) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const scheduleNext = (): void => {
      if (cancelled) {
        return;
      }
      if (attempt >= delaysMs.length) {
        onExhausted();
        return;
      }
      const delayMs = delaysMs[attempt] ?? 0;
      attempt += 1;
      timer = setTimeout(() => {
        void refresh().finally(() => {
          if (!cancelled) {
            scheduleNext();
          }
        });
      }, delayMs);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [activationPending, billingUpdateSettled, refresh, delaysMs, onExhausted]);
}
