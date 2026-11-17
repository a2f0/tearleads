import {
  AUTO_PROVISIONING_IDLE,
  type AutoProvisioningStep,
} from "./autoProvisioningStatus";

/**
 * One autopilot registration request: the fingerprint it reports under and
 * the identity snapshot it started under.
 */
export interface RegistrationRun {
  readonly fingerprint: string | null;
  readonly identity: object;
}

interface RegistrationOutcome {
  readonly fingerprint: string | null;
  readonly step: AutoProvisioningStep;
}

/**
 * The autopilot's registration lifecycle, one run at a time. `rearm` counts
 * runs whose identity changed underneath them; each re-arms registration for
 * the identity now current. `outcome` is the last unsuperseded run's result.
 */
export type RegistrationRunState =
  | {
      readonly status: "idle";
      readonly outcome: RegistrationOutcome | null;
      readonly rearm: number;
    }
  | {
      readonly status: "running";
      readonly rearm: number;
      readonly run: RegistrationRun;
    };

export type RegistrationRunEvent =
  | { readonly type: "started"; readonly run: RegistrationRun }
  | {
      readonly type: "settled";
      /** The identity snapshot current when the run settled. */
      readonly identity: object;
      readonly run: RegistrationRun;
      readonly step: AutoProvisioningStep;
    };

export const INITIAL_REGISTRATION_RUN: RegistrationRunState = {
  outcome: null,
  rearm: 0,
  status: "idle",
};

const RUNNING: AutoProvisioningStep = { status: "running" };

export function transitionRegistrationRun(
  state: RegistrationRunState,
  event: RegistrationRunEvent,
): RegistrationRunState {
  switch (event.type) {
    case "started":
      return state.status === "running"
        ? state
        : { rearm: state.rearm, run: event.run, status: "running" };
    case "settled":
      if (state.status !== "running" || state.run !== event.run) {
        return state;
      }
      // A run for an unchanged identity reports its result and re-arms
      // nothing, so a failure is not retried in a loop. One whose identity
      // changed (a switch away, even one switched back) reports nothing.
      return event.identity === event.run.identity
        ? {
            outcome: { fingerprint: event.run.fingerprint, step: event.step },
            rearm: state.rearm,
            status: "idle",
          }
        : { outcome: null, rearm: state.rearm + 1, status: "idle" };
  }
}

/** The step shown for `fingerprint`: only its own run or result. */
export function registrationStepFor(
  state: RegistrationRunState,
  fingerprint: string | null,
): AutoProvisioningStep {
  if (state.status === "running") {
    return state.run.fingerprint === fingerprint
      ? RUNNING
      : AUTO_PROVISIONING_IDLE;
  }
  return state.outcome?.fingerprint === fingerprint
    ? state.outcome.step
    : AUTO_PROVISIONING_IDLE;
}
