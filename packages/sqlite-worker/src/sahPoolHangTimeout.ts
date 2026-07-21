/**
 * Upper bound on a SINGLE SAHPool handle-acquiring step (one `installOpfsSAHPoolVfs`
 * attempt, or the `reserveMinimumCapacity` reservation).
 *
 * The SAHPool install's contention retry only reacts to a *thrown*
 * `NoModificationAllowedError`. On Android WebView, under per-origin
 * `SyncAccessHandle` pressure (a previous identity's worker still releasing its
 * ~12 handles when the next identity's worker boots), `createSyncAccessHandle` can
 * instead **hang** — never resolving and never rejecting. A hung await is neither
 * retried nor surfaced, so `initDatabase` never settles, the worker goes silent,
 * and the ONLY timer that ever fires is the app's 15s boot-round-trip timeout —
 * after which the app re-spawns a fresh worker that hits the exact same hang.
 * Racing each acquiring step against this bound converts that silent hang into a
 * fast rejection, so init settles (as an error), the worker answers and is torn
 * down cleanly (releasing its handles), and the normal boot retry re-attempts on a
 * fresh worker as the origin drains — the desktop behaviour, where the same
 * contention throws promptly instead of hanging.
 *
 * Sized so the worst-case worker-side settle — up to the ~3s SAHPool install
 * contention-retry budget followed by one hung step — still rejects several
 * seconds below the 15s app boot timeout (see bootSQLiteRuntime.ts), so the
 * worker's error reliably wins that race. Far above a healthy step (a fresh pool
 * installs in well under a second), so a valid slow-but-progressing boot is never
 * tripped.
 */
export const SAHPOOL_STEP_HANG_TIMEOUT_MS = 8_000;

/**
 * Marks a SAHPool acquiring step that did not settle within
 * {@link SAHPOOL_STEP_HANG_TIMEOUT_MS} — the Android "hung `createSyncAccessHandle`"
 * signature. Distinct from `NoModificationAllowedError` (a clean throw that leaves
 * no half-acquired handles and is safe to retry in place); a hang is surfaced, not
 * retried in the same worker, because a second concurrent install would only pile
 * more half-open handles onto the already-saturated origin.
 */
export class SahPoolStepTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SahPoolStepTimeoutError";
  }
}

/**
 * Reject with {@link SahPoolStepTimeoutError} if `operation` has not settled within
 * `timeoutMs`. The abandoned operation stays pending (harmless — the worker is torn
 * down on the resulting init failure, which releases any handles it half-acquired),
 * while the timer is always cleared so a fast success leaves nothing behind. The
 * operation's own rejection is swallowed so an abandoned-then-rejected step cannot
 * become an unhandled rejection after the race is decided.
 */
export function withSahPoolStepHangTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  operation.catch(() => {});
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new SahPoolStepTimeoutError(
            `SAHPool handle acquisition did not settle within ${timeoutMs}ms (likely a hung createSyncAccessHandle under OPFS handle-cap contention).`,
          ),
        );
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}
