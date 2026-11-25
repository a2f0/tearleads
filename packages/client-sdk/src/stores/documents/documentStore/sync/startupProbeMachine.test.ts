import { expect, test } from "bun:test";
import {
  initialStartupProbeState,
  type StartupProbeEvent,
  type StartupProbeState,
  transitionStartupProbe,
} from "./startupProbeMachine";

const ON_DEMAND: StartupProbeState = { status: "onDemand" };
const WANTED: StartupProbeState = { status: "wanted" };
const DEFERRED: StartupProbeState = { attempt: 3, status: "deferred" };

function joined(
  probeOwed: boolean,
  pendingConnectAttempt?: number,
): StartupProbeEvent {
  return { pendingConnectAttempt, probeOwed, type: "joined" };
}

function loaded(
  remote: boolean,
  pendingConnectAttempt?: number,
  covered = false,
) {
  return { covered, pendingConnectAttempt, remote, type: "loaded" } as const;
}

function runtimeInstalled(
  reconnected: boolean,
  pendingConnectAttempt?: number,
) {
  return {
    pendingConnectAttempt,
    reconnected,
    type: "runtimeInstalled",
  } as const;
}

const RESET: StartupProbeEvent = { type: "reset" };

test("the open mode picks the first state", () => {
  expect(initialStartupProbeState("startup")).toEqual(WANTED);
  expect(initialStartupProbeState("on-demand")).toEqual(ON_DEMAND);
});

test.each<
  [string, StartupProbeState, StartupProbeEvent, StartupProbeState, boolean]
>([
  ["join before load", ON_DEMAND, joined(false), WANTED, false],
  ["join with a probe owed", ON_DEMAND, joined(true), WANTED, true],
  [
    "join during a connect",
    ON_DEMAND,
    joined(true, 7),
    { attempt: 7, status: "deferred" },
    false,
  ],
  ["load of a remote record", WANTED, loaded(true), WANTED, true],
  [
    "load during a connect",
    WANTED,
    loaded(true, 7),
    { attempt: 7, status: "deferred" },
    false,
  ],
  ["load of a local-only record", WANTED, loaded(false), WANTED, false],
  ["load while deferred", DEFERRED, loaded(true), WANTED, true],
  [
    "load while deferred during a connect",
    DEFERRED,
    loaded(true, 7),
    { attempt: 7, status: "deferred" },
    false,
  ],
  [
    "reconnect covers the deferred probe",
    DEFERRED,
    runtimeInstalled(true, 3),
    WANTED,
    false,
  ],
  [
    "same attempt still open",
    DEFERRED,
    runtimeInstalled(false, 3),
    DEFERRED,
    false,
  ],
  ["attempt ended", DEFERRED, runtimeInstalled(false), WANTED, true],
  [
    "another attempt started",
    DEFERRED,
    runtimeInstalled(false, 4),
    WANTED,
    true,
  ],
  ["reset forgets the deferral", DEFERRED, RESET, WANTED, false],
])("%s", (_name, state, event, next, arm) => {
  expect(transitionStartupProbe(state, event)).toEqual({ arm, state: next });
});

test.each<[string, StartupProbeState, StartupProbeEvent]>([
  ["a second join", WANTED, joined(true)],
  ["a join while deferred", DEFERRED, joined(true)],
  ["an on-demand load", ON_DEMAND, loaded(true)],
  ["a local-only load while deferred", DEFERRED, loaded(false)],
  ["a load a listing covers", WANTED, loaded(true, undefined, true)],
  ["a covered load during a connect", WANTED, loaded(true, 7, true)],
  ["a covered load while deferred", DEFERRED, loaded(true, undefined, true)],
  ["a runtime without a deferral", WANTED, runtimeInstalled(false)],
  ["an on-demand runtime", ON_DEMAND, runtimeInstalled(true)],
  ["an on-demand reset", ON_DEMAND, RESET],
  ["a wanted reset", WANTED, RESET],
])("%s changes nothing and arms nothing", (_name, state, event) => {
  const result = transitionStartupProbe(state, event);
  expect(result.arm).toBe(false);
  expect(result.state).toEqual(state);
});
