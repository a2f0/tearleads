import type { RequestResultOptions } from "@tearleads/api-client";

/** One host-configurable deadline covers dispatch and all preparation exchanges. */
export function createPrincipalMutationDispatcher(timeoutMs = 60_000) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  )
    throw new RangeError(
      "Principal mutation timeout must be a positive integer no greater than 2147483647 milliseconds",
    );
  return async <T>(
    options: RequestResultOptions | undefined,
    submit: (options: RequestResultOptions) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await submit({
        ...options,
        signal: options?.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
