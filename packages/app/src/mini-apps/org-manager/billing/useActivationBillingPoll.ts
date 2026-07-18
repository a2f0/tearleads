import { useEffect } from "react";

/**
 * Backoff schedule (ms) for re-reading server billing after a successful
 * purchase. The client-side purchase resolves immediately, but the RevenueCat
 * webhook that flips this org's `organization_billing` row to active lands a
 * beat later — so a single post-purchase refresh usually still reports the old
 * status. We re-read a few times on this schedule until the billing snapshot
 * reports the org can sync; if it never does (e.g. the buyer is not an org
 * admin, so the webhook ignores the grant), the schedule is exhausted and the
 * "activation pending" hint remains for a manual refresh.
 */
export const ACTIVATION_POLL_DELAYS_MS: readonly number[] = [
  1000, 2000, 3000, 5000, 8000,
];

/**
 * While an org's activation is pending (a purchase resolved but the server
 * billing row has not flipped to syncable yet), re-read billing on a backoff
 * schedule so the panel reflects the purchase without a manual refresh. The
 * effect is gated on `activationPending && !billingCanSync`, so it stops the
 * moment billing reports the org can sync (which also clears the pending flag)
 * or the pending flag is reset by a scope change; the cleanup cancels any
 * scheduled refresh. `delaysMs` is injectable so tests can drive it without real
 * timers; production uses {@link ACTIVATION_POLL_DELAYS_MS}.
 */
export function useActivationBillingPoll(
  activationPending: boolean,
  billingCanSync: boolean,
  refresh: () => Promise<void>,
  delaysMs: readonly number[],
): void {
  useEffect(() => {
    if (!activationPending || billingCanSync) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const scheduleNext = (): void => {
      if (cancelled || attempt >= delaysMs.length) {
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
  }, [activationPending, billingCanSync, refresh, delaysMs]);
}
