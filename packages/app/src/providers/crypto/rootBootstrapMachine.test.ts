import { expect, test } from "bun:test";
import {
  type RootBootstrap,
  type RootBootstrapAttempt,
  type RootBootstrapEvent,
  transitionRootBootstrap,
} from "./rootBootstrapMachine";

const attempt = (name: string) =>
  ({ signingFingerprint: name }) as unknown as RootBootstrapAttempt;
const first = attempt("first");
const second = attempt("second");

function run(
  state: RootBootstrap,
  ...events: RootBootstrapEvent[]
): RootBootstrap {
  return events.reduce(transitionRootBootstrap, state);
}

const idle: RootBootstrap = { status: "idle" };
const running = run(idle, { type: "start", attempt: first });

test("a finished run settles its attempt, and only its own run can finish it", () => {
  expect(running).toEqual({ status: "running", attempt: first, wanted: true });
  expect(run(running, { type: "settled", attempt: second })).toBe(running);
  expect(run(running, { type: "settled", attempt: first })).toEqual({
    status: "settled",
    attempt: first,
  });
  expect(run(running, { type: "failed", attempt: first })).toEqual(idle);
});

test("a busy run waits, then runs its attempt again", () => {
  const waiting = run(running, { type: "busy", attempt: first });
  expect(waiting).toEqual({ status: "waitingBusy", attempt: first });
  expect(run(waiting, { type: "busyPauseEnded", attempt: second })).toBe(
    waiting,
  );
  expect(run(waiting, { type: "busyPauseEnded", attempt: first })).toEqual(
    running,
  );
});

test("a run no longer wanted ends without waiting out a busy refusal", () => {
  const lapsed = run(running, { type: "lapse" });
  expect(lapsed).toEqual({ status: "running", attempt: first, wanted: false });
  expect(run(lapsed, { type: "busy", attempt: first })).toEqual(idle);
  // A StrictMode remount wants the same run again before it notices.
  expect(run(lapsed, { type: "wanted", attempt: first })).toEqual(running);
  expect(
    run(
      running,
      { type: "busy", attempt: first },
      { type: "lapse" },
      { type: "busyPauseEnded", attempt: first },
    ),
  ).toEqual(idle);
});

test("a reset or a new attempt replaces every state", () => {
  const settled = run(running, { type: "settled", attempt: first });
  // A settled attempt stays recorded through a lapse so it never reruns.
  expect(run(settled, { type: "lapse" })).toBe(settled);
  for (const state of [
    running,
    settled,
    run(running, { type: "busy", attempt: first }),
  ]) {
    expect(run(state, { type: "reset" })).toEqual(idle);
    expect(run(state, { type: "start", attempt: second })).toEqual({
      status: "running",
      attempt: second,
      wanted: true,
    });
  }
});
