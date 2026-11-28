import { expect, test } from "bun:test";
import {
  STOPPED_UNACKNOWLEDGED_CATCH_UP,
  transitionUnacknowledgedCatchUp,
  type UnacknowledgedCatchUpState,
} from "./unacknowledgedCatchUpMachine";

test("stopped state ignores every event except start", () => {
  const run = {};
  expect(
    transitionUnacknowledgedCatchUp(STOPPED_UNACKNOWLEDGED_CATCH_UP, {
      eligible: true,
      type: "evaluate",
    }),
  ).toEqual({ effect: "none", state: STOPPED_UNACKNOWLEDGED_CATCH_UP });
  expect(
    transitionUnacknowledgedCatchUp(STOPPED_UNACKNOWLEDGED_CATCH_UP, {
      run,
      type: "sweep-started",
    }),
  ).toEqual({ effect: "none", state: STOPPED_UNACKNOWLEDGED_CATCH_UP });
  expect(
    transitionUnacknowledgedCatchUp(STOPPED_UNACKNOWLEDGED_CATCH_UP, {
      eligible: true,
      run,
      type: "timer-fired",
    }),
  ).toEqual({ effect: "none", state: STOPPED_UNACKNOWLEDGED_CATCH_UP });
  expect(
    transitionUnacknowledgedCatchUp(STOPPED_UNACKNOWLEDGED_CATCH_UP, {
      eligible: true,
      run,
      type: "sweep-settled",
    }),
  ).toEqual({ effect: "none", state: STOPPED_UNACKNOWLEDGED_CATCH_UP });
  expect(
    transitionUnacknowledgedCatchUp(STOPPED_UNACKNOWLEDGED_CATCH_UP, {
      type: "stop",
    }),
  ).toEqual({ effect: "none", state: STOPPED_UNACKNOWLEDGED_CATCH_UP });
});

test("start enters scheduled when eligible and idle otherwise", () => {
  expect(
    transitionUnacknowledgedCatchUp(STOPPED_UNACKNOWLEDGED_CATCH_UP, {
      eligible: true,
      type: "start",
    }),
  ).toEqual({ effect: "schedule", state: { status: "scheduled" } });
  expect(
    transitionUnacknowledgedCatchUp(STOPPED_UNACKNOWLEDGED_CATCH_UP, {
      eligible: false,
      type: "start",
    }),
  ).toEqual({ effect: "none", state: { status: "idle" } });
});

test("evaluate arms and cancels timers cleanly across eligibility edges", () => {
  const idle: UnacknowledgedCatchUpState = { status: "idle" };
  const scheduled = transitionUnacknowledgedCatchUp(idle, {
    eligible: true,
    type: "evaluate",
  });
  expect(scheduled).toEqual({
    effect: "schedule",
    state: { status: "scheduled" },
  });
  // Staying eligible does not reschedule and push the timer out.
  expect(
    transitionUnacknowledgedCatchUp(scheduled.state, {
      eligible: true,
      type: "evaluate",
    }),
  ).toEqual({ effect: "none", state: { status: "scheduled" } });
  // Losing eligibility cancels immediately.
  expect(
    transitionUnacknowledgedCatchUp(scheduled.state, {
      eligible: false,
      type: "evaluate",
    }),
  ).toEqual({ effect: "cancel", state: { status: "idle" } });
});

test("sweep-started cancels a pending timer and ignores stale run settlement", () => {
  const firstRun = {};
  const secondRun = {};
  const runningFirst = transitionUnacknowledgedCatchUp(
    { status: "scheduled" },
    { run: firstRun, type: "sweep-started" },
  );
  expect(runningFirst).toEqual({
    effect: "cancel",
    state: { run: firstRun, status: "running" },
  });

  const runningSecond = transitionUnacknowledgedCatchUp(runningFirst.state, {
    run: secondRun,
    type: "sweep-started",
  });
  expect(runningSecond).toEqual({
    effect: "none",
    state: { run: secondRun, status: "running" },
  });

  // Settling the superseded first run leaves the second run active.
  expect(
    transitionUnacknowledgedCatchUp(runningSecond.state, {
      eligible: true,
      run: firstRun,
      type: "sweep-settled",
    }),
  ).toEqual({ effect: "none", state: runningSecond.state });

  // Settling the current run schedules when eligible, or idles otherwise.
  expect(
    transitionUnacknowledgedCatchUp(runningSecond.state, {
      eligible: true,
      run: secondRun,
      type: "sweep-settled",
    }),
  ).toEqual({ effect: "schedule", state: { status: "scheduled" } });
  expect(
    transitionUnacknowledgedCatchUp(runningSecond.state, {
      eligible: false,
      run: secondRun,
      type: "sweep-settled",
    }),
  ).toEqual({ effect: "none", state: { status: "idle" } });
});

test("timer-fired runs when still eligible and idles otherwise", () => {
  const run = {};
  expect(
    transitionUnacknowledgedCatchUp(
      { status: "scheduled" },
      { eligible: true, run, type: "timer-fired" },
    ),
  ).toEqual({ effect: "run", state: { run, status: "running" } });
  expect(
    transitionUnacknowledgedCatchUp(
      { status: "scheduled" },
      { eligible: false, run, type: "timer-fired" },
    ),
  ).toEqual({ effect: "none", state: { status: "idle" } });
});

test("stop cancels a scheduled timer and prevents late sweeps from rescheduling", () => {
  const run = {};
  expect(
    transitionUnacknowledgedCatchUp({ status: "scheduled" }, { type: "stop" }),
  ).toEqual({ effect: "cancel", state: STOPPED_UNACKNOWLEDGED_CATCH_UP });
  const stoppedFromRunning = transitionUnacknowledgedCatchUp(
    { run, status: "running" },
    { type: "stop" },
  );
  expect(stoppedFromRunning).toEqual({
    effect: "none",
    state: STOPPED_UNACKNOWLEDGED_CATCH_UP,
  });
  expect(
    transitionUnacknowledgedCatchUp(stoppedFromRunning.state, {
      eligible: true,
      run,
      type: "sweep-settled",
    }),
  ).toEqual({ effect: "none", state: STOPPED_UNACKNOWLEDGED_CATCH_UP });
});
