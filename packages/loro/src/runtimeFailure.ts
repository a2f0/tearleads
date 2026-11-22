/**
 * Whether `error` is the Loro runtime failing rather than Loro refusing a
 * payload: a WebAssembly trap (a Rust panic, or an allocation that aborted)
 * or a RangeError (memory or stack exhausted). Such a failure may depend on
 * the process that met it, so it is not a verdict about the payload, and a
 * trap can leave the module unusable for the rest of the process.
 */
export function isLoroRuntimeFailure(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    (typeof WebAssembly !== "undefined" &&
      error instanceof WebAssembly.RuntimeError)
  );
}
