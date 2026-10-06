import type { RequestResultOptions } from "./types";

/** A fresh timer for one response, including its body; continuations reset it. */
export function principalHistoryDeadline(
  options: RequestResultOptions,
  timeoutMs: number | null = 15_000,
) {
  if (timeoutMs === null)
    return { options, expired: () => false, dispose: () => {} };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError(
      "Principal request timeout must be positive and finite",
    );
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
