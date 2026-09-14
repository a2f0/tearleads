import type { LocalKeyringLockEnvironment } from "./localKeyringLockSupport";

/**
 * Reports a PIN-action failure to the diagnostics adapter. The lock provider
 * mounts outside `LogProvider`, so `useLog().logError` is unavailable here;
 * this mirrors its forwarding rule: only real `Error`s cross the boundary (the
 * adapter keeps the error type and stack locations and discards messages), and
 * reporting never throws into the action that failed.
 *
 * Callers must only pass genuine failures. A wrong PIN is a user typo, not a
 * defect, and every action screens it out before its failure path runs.
 */
export function reportLockFailure(
  environment: LocalKeyringLockEnvironment,
  error: unknown,
): void {
  if (!(error instanceof Error)) {
    return;
  }
  try {
    environment.diagnostics?.captureError(error, {
      area: "app",
      source: "log",
    });
  } catch {
    // The action already failed; a broken diagnostics adapter must not mask it.
  }
}
