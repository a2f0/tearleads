import { describe, expect, test } from "bun:test";
import {
  INITIAL_REGISTRATION_RUN,
  type RegistrationRun,
  type RegistrationRunState,
  registrationStepFor,
  transitionRegistrationRun,
} from "./registrationRunMachine";

const identityA = {};
const failed = { message: "refused", status: "failed" } as const;

function started(run: RegistrationRun): RegistrationRunState {
  return transitionRegistrationRun(INITIAL_REGISTRATION_RUN, {
    run,
    type: "started",
  });
}

describe("transitionRegistrationRun", () => {
  test("holds one run at a time, shown only for its own identity", () => {
    const run = { fingerprint: "a", identity: identityA };
    const running = started(run);
    const again = transitionRegistrationRun(running, {
      run: { fingerprint: "a", identity: identityA },
      type: "started",
    });

    expect(again).toBe(running);
    expect(registrationStepFor(running, "a")).toEqual({ status: "running" });
    expect(registrationStepFor(running, "b")).toEqual({ status: "idle" });
  });

  test("a run for an unchanged identity reports its result and re-arms nothing", () => {
    const run = { fingerprint: "a", identity: identityA };
    const settled = transitionRegistrationRun(started(run), {
      identity: identityA,
      run,
      step: failed,
      type: "settled",
    });

    expect(settled).toMatchObject({ rearm: 0, status: "idle" });
    expect(registrationStepFor(settled, "a")).toEqual(failed);
    expect(registrationStepFor(settled, "b")).toEqual({ status: "idle" });
  });

  test("a run whose identity changed reports nothing and re-arms", () => {
    const run = { fingerprint: "a", identity: identityA };
    // Switched away and back: the same fingerprint, a newer identity snapshot.
    const settled = transitionRegistrationRun(started(run), {
      identity: {},
      run,
      step: failed,
      type: "settled",
    });

    expect(settled).toMatchObject({ rearm: 1, status: "idle" });
    expect(registrationStepFor(settled, "a")).toEqual({ status: "idle" });
  });

  test("a settle for a run no longer outstanding is ignored", () => {
    const running = started({ fingerprint: "a", identity: identityA });

    expect(
      transitionRegistrationRun(running, {
        identity: identityA,
        run: { fingerprint: "a", identity: identityA },
        step: failed,
        type: "settled",
      }),
    ).toBe(running);
  });
});
