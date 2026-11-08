import { expect, test } from "bun:test";
import {
  IDLE_RECOVERY_HYDRATION,
  type RecoveryHydrationState,
  transitionRecoveryHydration,
} from "./recoveryHydrationMachine";

interface Request {
  readonly input: object;
}

const first: Request = { input: {} };
const second: Request = { input: {} };
const run = Promise.resolve();
const nextRun = Promise.resolve();

test("requests queue once per input, beside a running run too", () => {
  const queued = transitionRecoveryHydration<Request>(IDLE_RECOVERY_HYDRATION, {
    request: first,
    type: "queued",
  });
  expect(queued).toEqual({ requests: [first], status: "queued" });
  expect(
    transitionRecoveryHydration(queued, {
      request: { input: first.input },
      type: "queued",
    }),
  ).toEqual(queued);

  const running: RecoveryHydrationState<Request> = { run, status: "running" };
  const waiting = transitionRecoveryHydration(running, {
    request: second,
    type: "queued",
  });
  expect(waiting).toEqual({
    requests: [second],
    run,
    status: "running-with-queued",
  });
});

test("a start takes the queue over; only the current run settles it", () => {
  const queued: RecoveryHydrationState<Request> = {
    requests: [first],
    status: "queued",
  };
  const running = transitionRecoveryHydration(queued, {
    run,
    type: "started",
  });
  expect(running).toEqual({ run, status: "running" });
  expect(
    transitionRecoveryHydration(running, { run: nextRun, type: "settled" }),
  ).toBe(running);
  expect(transitionRecoveryHydration(running, { run, type: "settled" })).toBe(
    IDLE_RECOVERY_HYDRATION,
  );

  // A request queued during the run waits for the next resume.
  const waiting: RecoveryHydrationState<Request> = {
    requests: [second],
    run,
    status: "running-with-queued",
  };
  expect(
    transitionRecoveryHydration(waiting, { run, type: "settled" }),
  ).toEqual({ requests: [second], status: "queued" });
  expect(
    transitionRecoveryHydration(waiting, { run: nextRun, type: "started" }),
  ).toEqual({ run: nextRun, status: "running" });
});

test("a start with nothing queued is ignored", () => {
  const running: RecoveryHydrationState<Request> = { run, status: "running" };
  for (const state of [IDLE_RECOVERY_HYDRATION, running]) {
    expect(
      transitionRecoveryHydration<Request>(state, {
        run: nextRun,
        type: "started",
      }),
    ).toBe(state);
  }
});
