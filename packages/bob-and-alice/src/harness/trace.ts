const { HARNESS_TRACE } = process.env;

/** Prints scenario diagnostics when `HARNESS_TRACE` is set. */
export function trace(message: string): void {
  if (HARNESS_TRACE) {
    console.log(`[harness] ${message}`);
  }
}
