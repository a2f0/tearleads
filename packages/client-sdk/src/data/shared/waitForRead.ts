/** Release the caller's wait on a read-only host operation when its scope expires. */
export async function waitForRead<T>(
  read: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return read;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    // The host may finish after cancellation. Observe either outcome.
    void read.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
