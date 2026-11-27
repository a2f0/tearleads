const { HARNESS_TRACE } = process.env;
const opSinkKey = "__tearleadsPerfScenarioOpSink";

/** Prints scenario diagnostics when `HARNESS_TRACE` is set. */
export function trace(message: string): void {
  const sink: unknown = Reflect.get(globalThis, opSinkKey);
  if (typeof sink === "function") sink(message);
  if (HARNESS_TRACE) {
    console.log(`[harness] ${message}`);
  }
}
