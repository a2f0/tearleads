import { describe, expect, test } from "bun:test";
import {
  hasSystemBootstrapCompleted,
  initialSystemBootstrapState,
  type SystemBootstrapEvent,
  type SystemBootstrapState,
  transitionSystemBootstrap,
} from "./systemBootstrapMachine";

const RUN_A = { name: "run-a" };
const RUN_B = { name: "run-b" };
const ERROR = new Error("boom");

const idle: SystemBootstrapState = { status: "idle" };
const waiting: SystemBootstrapState = {
  attempt: null,
  hasCompleted: false,
  status: "waiting",
};
const waitingDone: SystemBootstrapState = {
  attempt: null,
  hasCompleted: true,
  status: "waiting",
};
const runningA: SystemBootstrapState = {
  wakePending: false,
  hasCompleted: false,
  run: RUN_A,
  status: "running",
};
const rerunningA: SystemBootstrapState = {
  wakePending: false,
  hasCompleted: true,
  run: RUN_A,
  status: "running",
};
const ready: SystemBootstrapState = { status: "ready" };
const failed: SystemBootstrapState = {
  error: ERROR,
  hasCompleted: false,
  status: "error",
};

function run(
  state: SystemBootstrapState,
  events: ReadonlyArray<SystemBootstrapEvent>,
): SystemBootstrapState {
  return events.reduce(transitionSystemBootstrap, state);
}

describe("system bootstrap transitions", () => {
  test.each<
    [string, SystemBootstrapState, SystemBootstrapEvent, SystemBootstrapState]
  >([
    ["idle + input-missing", idle, { type: "input-missing" }, waiting],
    ["idle + run-started", idle, { run: RUN_A, type: "run-started" }, runningA],
    [
      "waiting + run-started",
      waiting,
      { run: RUN_A, type: "run-started" },
      runningA,
    ],
    [
      "ready + run-started keeps the latch",
      ready,
      { run: RUN_A, type: "run-started" },
      rerunningA,
    ],
    [
      "error + run-started",
      failed,
      { run: RUN_A, type: "run-started" },
      runningA,
    ],
    [
      "running + run-succeeded",
      runningA,
      { run: RUN_A, type: "run-succeeded" },
      ready,
    ],
    [
      "running + run-incomplete",
      runningA,
      { run: RUN_A, type: "run-incomplete" },
      { ...waiting, attempt: { run: RUN_A, wakePending: false } },
    ],
    [
      "rerun + run-incomplete keeps the latch",
      rerunningA,
      { run: RUN_A, type: "run-incomplete" },
      { ...waitingDone, attempt: { run: RUN_A, wakePending: false } },
    ],
    [
      "running + run-failed",
      runningA,
      { error: ERROR, run: RUN_A, type: "run-failed" },
      failed,
    ],
    [
      "running + run-superseded without input",
      runningA,
      { inputMissing: true, run: RUN_A, type: "run-superseded" },
      waiting,
    ],
    ["waiting + target-complete", waiting, { type: "target-complete" }, ready],
    ["running + target-complete", runningA, { type: "target-complete" }, ready],
    [
      "error + input-missing clears the error",
      failed,
      { type: "input-missing" },
      waiting,
    ],
    [
      "ready + input-missing keeps the latch",
      ready,
      { type: "input-missing" },
      waitingDone,
    ],
    ["ready + disable", ready, { type: "disable" }, idle],
    ["running + disable", runningA, { type: "disable" }, idle],
  ])("%s", (_name, state, event, next) => {
    expect(transitionSystemBootstrap(state, event)).toEqual(next);
  });

  test.each<[string, SystemBootstrapState, SystemBootstrapEvent]>([
    ["idle + disable", idle, { type: "disable" }],
    [
      "running + input-missing (the run settles it)",
      runningA,
      { type: "input-missing" },
    ],
    [
      "running + run-started for the same run",
      runningA,
      { run: RUN_A, type: "run-started" },
    ],
    [
      "running + run-superseded with a newer input",
      runningA,
      { inputMissing: false, run: RUN_A, type: "run-superseded" },
    ],
    [
      "running A + run-succeeded B",
      runningA,
      { run: RUN_B, type: "run-succeeded" },
    ],
    [
      "running A + run-failed B",
      runningA,
      { error: ERROR, run: RUN_B, type: "run-failed" },
    ],
    ["idle + run-succeeded", idle, { run: RUN_A, type: "run-succeeded" }],
    [
      "waiting + run-incomplete",
      waiting,
      { run: RUN_A, type: "run-incomplete" },
    ],
    [
      "ready + run-failed",
      ready,
      { error: ERROR, run: RUN_A, type: "run-failed" },
    ],
    [
      "error + run-superseded",
      failed,
      { inputMissing: true, run: RUN_A, type: "run-superseded" },
    ],
    ["ready + target-complete", ready, { type: "target-complete" }],
    ["waiting + input-missing", waiting, { type: "input-missing" }],
  ])("%s is ignored (same reference)", (_name, state, event) => {
    expect(transitionSystemBootstrap(state, event)).toBe(state);
  });

  test("a stale run cannot finish after a reset and a newer run", () => {
    const state = run(waiting, [
      { run: RUN_A, type: "run-started" },
      { type: "disable" },
      { type: "input-missing" },
      { run: RUN_B, type: "run-started" },
      { run: RUN_A, type: "run-succeeded" },
      { error: ERROR, run: RUN_A, type: "run-failed" },
      { inputMissing: true, run: RUN_A, type: "run-superseded" },
    ]);
    expect(state).toEqual({
      hasCompleted: false,
      run: RUN_B,
      status: "running",
      wakePending: false,
    });
  });

  test("a replacement run takes over the running state", () => {
    const state = run(waiting, [
      { run: RUN_A, type: "run-started" },
      { inputMissing: false, run: RUN_A, type: "run-superseded" },
      { run: RUN_B, type: "run-started" },
    ]);
    expect(state).toEqual({
      hasCompleted: false,
      run: RUN_B,
      status: "running",
      wakePending: false,
    });
    expect(run(state, [{ run: RUN_B, type: "run-succeeded" }])).toEqual(ready);
  });

  test("a matching wake coalesces during work and survives incomplete settlement once", () => {
    const pending = transitionSystemBootstrap(runningA, {
      run: RUN_A,
      type: "contacts-persisted",
    });
    expect(pending).toEqual({ ...runningA, wakePending: true });
    expect(
      transitionSystemBootstrap(pending, {
        run: RUN_A,
        type: "contacts-persisted",
      }),
    ).toBe(pending);
    const incomplete = transitionSystemBootstrap(pending, {
      run: RUN_A,
      type: "run-incomplete",
    });
    expect(incomplete).toEqual({
      ...waiting,
      attempt: { run: RUN_A, wakePending: true },
    });
    const consumed = transitionSystemBootstrap(incomplete, {
      run: RUN_A,
      type: "wake-consumed",
    });
    expect(consumed).toEqual({
      ...waiting,
      attempt: { run: RUN_A, wakePending: false },
    });
    expect(
      transitionSystemBootstrap(consumed, {
        run: RUN_A,
        type: "wake-consumed",
      }),
    ).toBe(consumed);
    expect(
      run(consumed, [
        { run: RUN_B, type: "run-started" },
        { run: RUN_A, type: "contacts-persisted" },
        { run: RUN_B, type: "run-incomplete" },
      ]),
    ).toEqual({ ...waiting, attempt: { run: RUN_B, wakePending: false } });
  });

  test("a waiting attempt accepts its wake and rejects another attempt's ticket", () => {
    const incomplete = transitionSystemBootstrap(runningA, {
      run: RUN_A,
      type: "run-incomplete",
    });
    expect(
      transitionSystemBootstrap(incomplete, {
        run: RUN_B,
        type: "contacts-persisted",
      }),
    ).toBe(incomplete);
    const pending = transitionSystemBootstrap(incomplete, {
      run: RUN_A,
      type: "contacts-persisted",
    });
    expect(pending).toEqual({
      ...waiting,
      attempt: { run: RUN_A, wakePending: true },
    });
    expect(
      transitionSystemBootstrap(pending, {
        run: RUN_B,
        type: "wake-consumed",
      }),
    ).toBe(pending);
    expect(
      transitionSystemBootstrap(pending, { type: "input-missing" }),
    ).toEqual(waiting);
  });

  test.each<[string, SystemBootstrapState]>([
    ["idle", idle],
    ["unattempted waiting", waiting],
    ["ready", ready],
    ["error", failed],
  ])("%s ignores persistence and wake consumption", (_name, state) => {
    expect(
      transitionSystemBootstrap(state, {
        run: RUN_A,
        type: "contacts-persisted",
      }),
    ).toBe(state);
    expect(
      transitionSystemBootstrap(state, {
        run: RUN_A,
        type: "wake-consumed",
      }),
    ).toBe(state);
  });

  test.each<[SystemBootstrapEvent, SystemBootstrapState]>([
    [{ run: RUN_A, type: "run-succeeded" }, ready],
    [{ run: RUN_A, type: "run-failed", error: ERROR }, failed],
    [{ type: "disable" }, idle],
    [{ run: RUN_A, type: "run-superseded", inputMissing: true }, waiting],
  ])("%o discards a pending wake", (event, expected) => {
    expect(
      transitionSystemBootstrap({ ...runningA, wakePending: true }, event),
    ).toEqual(expected);
  });

  test("only states that can carry an error do, and idle never completed", () => {
    expect(initialSystemBootstrapState(true)).toEqual(waiting);
    expect(initialSystemBootstrapState(false)).toEqual(idle);
    expect(hasSystemBootstrapCompleted(idle)).toBe(false);
    expect(hasSystemBootstrapCompleted(ready)).toBe(true);
    expect(hasSystemBootstrapCompleted(rerunningA)).toBe(true);
    expect(
      run(failed, [{ run: RUN_A, type: "run-started" }]),
    ).not.toHaveProperty("error");
  });
});
