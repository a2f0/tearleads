/** Release the caller's wait on a read-only host operation when its scope expires. */
export async function waitForRead<T>(
  read: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return read;
  const stopped = Promise.withResolvers<never>();
  const abort = () => stopped.reject(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([read, stopped.promise]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
