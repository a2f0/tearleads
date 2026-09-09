// AbortSignal.timeout is unavailable on supported iOS 15 WebViews. The race
// also bounds callers when Capacitor's native HTTP bridge ignores abort signals.
export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Diagnostics request timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
