import type { RequestResultOptions } from "./types";

/** A fresh timer for one response, including its body; continuations reset it. */
export function principalHistoryDeadline(
  options: RequestResultOptions,
  timeoutMs = 15_000,
) {
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
