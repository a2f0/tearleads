import { expect, test } from "bun:test";
import {
  LORO_RUNTIME_HEALTHY,
  type LoroRuntimeHealth,
  type LoroRuntimeHealthEvent,
  transitionLoroRuntimeHealth,
} from "./loroRuntimeHealthMachine";

const failed = { type: "runtimeFailed" } as const;
const requested = (drain: number) =>
  ({ drain, type: "restartRequested" }) as const;
const drained = (drain: number) => ({ drain, type: "windowsDrained" }) as const;

function run(
  events: readonly LoroRuntimeHealthEvent[],
  from: LoroRuntimeHealth = LORO_RUNTIME_HEALTHY,
): LoroRuntimeHealth {
  return events.reduce(transitionLoroRuntimeHealth, from);
}

// A failure leaves the module suspect until the realm restarts, and only the
// user's request starts the drain that lets the host restart it.
test("a runtime failure asks for a restart the user then prepares", () => {
  expect(run([failed])).toEqual({ status: "restartRequired" });
  expect(run([failed, failed])).toEqual({ status: "restartRequired" });
  expect(run([failed, requested(1)])).toEqual({
    drain: 1,
    status: "draining",
  });
  expect(run([failed, requested(1), drained(1)])).toEqual({
    status: "ready",
  });
});

// One drain at a time: a second request joins the first, and only the
// drain the state is waiting on can end it.
test("a drain ends only by its own request", () => {
  const draining = run([requested(1)]);
  expect(transitionLoroRuntimeHealth(draining, requested(2))).toBe(draining);
  expect(transitionLoroRuntimeHealth(draining, drained(2))).toBe(draining);
  expect(transitionLoroRuntimeHealth(draining, failed)).toBe(draining);
  expect(run([drained(1)])).toBe(LORO_RUNTIME_HEALTHY);
});

// A host that kept a drained realm running asks again on its next failure,
// and may prepare again.
test("a drained realm that keeps running can fail and drain again", () => {
  const ready = run([requested(1), drained(1)]);
  expect(transitionLoroRuntimeHealth(ready, failed)).toEqual({
    status: "restartRequired",
  });
  expect(transitionLoroRuntimeHealth(ready, requested(2))).toEqual({
    drain: 2,
    status: "draining",
  });
});
