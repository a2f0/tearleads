import type { RequestResultOptions } from "./types";

/**
 * A fresh timer for one request, including its response body; `null` sets
 * none. A caller signal still cancels, but only the timer sets `expired()`,
 * so a caller can tell a timeout from a cancellation.
 */
export function requestDeadline(
  options: RequestResultOptions,
  timeoutMs: number | null,
) {
  if (timeoutMs === null)
    return { options, expired: () => false, dispose: () => {} };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("Request timeout must be positive and finite");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    options: {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal,
    },
    expired: () => controller.signal.aborted,
    dispose: () => clearTimeout(timer),
  };
}
