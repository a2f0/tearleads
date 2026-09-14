import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { isProjectionVerificationCancelledError } from "../../workflows/containers";
import { isDatabaseUnavailableError } from "../../workflows/documents";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import type { ContainerContentsStoreState } from "./types";

// Both host callbacks are declared `=> void` but may be async (see
// Tearleads.logError), and this runs from a catch that rethrows to the caller,
// where a throwing logger would replace the share failure with its own.
function dispatchToHost(call: () => unknown): void {
  try {
    void Promise.resolve(call()).catch(() => undefined);
  } catch {
    // Hosts may throw synchronously or return a rejected promise.
  }
}

/**
 * Report a thrown container share through the host's diagnostics before the
 * failure propagates to the UI. The app can only show a generic label, so this
 * is the one place the actual failure — a persistence error or an invariant
 * throw — is observable off the device.
 * Purely observational: the error is always rethrown by the caller unchanged.
 */
export function reportContainerShareFailure(
  state: ContainerContentsStoreState,
  operation: string,
  error: unknown,
): void {
  const message = `${getContainerContentsStoreLogLabel(state)}: ${operation} failed`;
  // Not an app failure, so it stays local: the runtime is released under
  // in-flight callers on every identity switch and host-driven database retry,
  // a projection verification cancelled by a newer generation re-runs on its
  // own, and a keying verification refusal (a rollback or a relabeled group,
  // which a duplicate grant can race into) belongs to the security-incident
  // path rather than app diagnostics.
  if (
    isDatabaseUnavailableError(error) ||
    isProjectionVerificationCancelledError(error) ||
    isKeyingVerificationError(error)
  ) {
    dispatchToHost(() => state.runtime.util.log(message));
    return;
  }

  const { logError } = state.runtime.util;
  if (!logError) {
    dispatchToHost(() => state.runtime.util.log(message));
    return;
  }

  dispatchToHost(() => logError(message, error));
}
