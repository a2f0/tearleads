import { expect, test } from "bun:test";
import {
  type ScreensaverState,
  transitionScreensaver,
} from "./screensaverMachine";

const states = [
  { status: "idle", session: 2 },
  { status: "grace", session: 2 },
  { status: "armed", session: 2 },
  { status: "draining", session: 2 },
  { status: "settling", session: 2 },
] satisfies ScreensaverState[];
test.each(states)("ignores stale timers in $status", (state) => {
  expect(
    transitionScreensaver(state, { type: "graceElapsed", session: 1 }),
  ).toBe(state);
  expect(transitionScreensaver(state, { type: "settled", session: 1 })).toBe(
    state,
  );
  expect(transitionScreensaver(state, { type: "stop" })).toEqual({
    status: "idle",
    session: 2,
  });
});

test("drains the wake gesture before idle and ignores activity outside armed", () => {
  const activity = { type: "dismiss", escape: false, drain: true } as const;
  const grace = { status: "grace", session: 1 } as const;
  expect(transitionScreensaver(grace, activity)).toBe(grace);
  const drain = transitionScreensaver(
    { status: "armed", session: 1 },
    activity,
  );
  expect(drain).toEqual({ status: "draining", session: 1 });
  expect(transitionScreensaver(drain, { type: "start" })).toBe(drain);
  const settling = transitionScreensaver(drain, { type: "released" });
  expect(settling).toEqual({ status: "settling", session: 1 });
  expect(transitionScreensaver(settling, activity)).toBe(settling);
  expect(
    transitionScreensaver(settling, { type: "settled", session: 1 }),
  ).toEqual({ status: "idle", session: 1 });
});

test("only the current grace timer arms a session, including after a restart", () => {
  const first = transitionScreensaver(
    { status: "idle", session: 0 },
    { type: "start" },
  );
  expect(
    transitionScreensaver(first, { type: "graceElapsed", session: 1 }),
  ).toEqual({ status: "armed", session: 1 });
  const stopped = transitionScreensaver(first, { type: "stop" });
  expect(stopped).toEqual({ status: "idle", session: 1 });
  expect(
    transitionScreensaver(stopped, { type: "graceElapsed", session: 1 }),
  ).toBe(stopped);
  const second = transitionScreensaver(stopped, { type: "start" });
  expect(second).toEqual({ status: "grace", session: 2 });
  expect(
    transitionScreensaver(second, { type: "graceElapsed", session: 1 }),
  ).toBe(second);
});

test("a start enters a tagged grace period and repeated starts do not reset it", () => {
  const started = transitionScreensaver(
    { status: "idle", session: 0 },
    { type: "start" },
  );
  expect(started).toEqual({ status: "grace", session: 1 });
  expect(transitionScreensaver(started, { type: "start" })).toBe(started);
});

test("a locked session drains waking input before prompting and accepts only its current verification", () => {
  let state = transitionScreensaver(
    { status: "idle", session: 0 },
    { type: "start", locked: true },
  );
  state = transitionScreensaver(state, {
    type: "dismiss",
    escape: true,
    drain: true,
  });
  expect(state.status).toBe("draining");
  expect(transitionScreensaver(state, { type: "stop" })).toBe(state);
  state = transitionScreensaver(state, { type: "released" });
  state = transitionScreensaver(state, { type: "settled", session: 1 });
  expect(state.status).toBe("unlock");
  state = transitionScreensaver(state, { type: "submit", pin: "000000" });
  expect(transitionScreensaver(state, { type: "stop" })).toBe(state);
  state = transitionScreensaver(state, {
    type: "verified",
    session: 1,
    attempt: 1,
    error: "incorrect",
    drain: false,
  });
  expect(state.status).toBe("unlock");
  state = transitionScreensaver(state, { type: "submit", pin: "824913" });
  expect(
    transitionScreensaver(state, {
      type: "verified",
      session: 1,
      attempt: 1,
      error: null,
      drain: false,
    }),
  ).toBe(state);
  expect(
    transitionScreensaver(state, {
      type: "verified",
      session: 0,
      attempt: 2,
      error: null,
      drain: false,
    }),
  ).toBe(state);
  state = transitionScreensaver(state, {
    type: "verified",
    session: 1,
    attempt: 2,
    error: null,
    drain: true,
  });
  expect(state).toEqual({ status: "draining", session: 1 });
  state = transitionScreensaver(state, { type: "released" });
  state = transitionScreensaver(state, { type: "settled", session: 1 });
  expect(state).toEqual({ status: "idle", session: 1 });
});
