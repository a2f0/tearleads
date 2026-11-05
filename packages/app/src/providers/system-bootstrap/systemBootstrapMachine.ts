// The system bootstrap status as an explicit state machine: one closed union of
// states and one pure transition. The React controller in
// SystemBootstrapProvider dispatches events; nothing here touches React.
//
// Each run is tagged with the input it started from (`run`). Run results carry
// that tag and only the run the state is currently running may finish it, so a
// late result from an earlier run never lands after a reset or a newer run.

export type SystemBootstrapStatus =
  | "idle"
  | "waiting"
  | "running"
  | "ready"
  | "error";

/** Identity of one provisioning run: the input object it started from. */
export type SystemBootstrapRunTag = object;

// `hasCompleted` latches once the first provisioning run for this scope
// completes. The gate (isBootstrapping) only blanks the mini-app for that
// initial run; later re-runs triggered by a converging container's syncState
// change must not unmount an already-hydrated Explorer back to a loading
// screen. `idle` has never completed and `ready` always has, so neither carries
// the latch.
export type SystemBootstrapState =
  | { readonly status: "idle" }
  | { readonly status: "waiting"; readonly hasCompleted: boolean }
  | {
      readonly status: "running";
      readonly hasCompleted: boolean;
      readonly run: SystemBootstrapRunTag;
    }
  | { readonly status: "ready" }
  | {
      readonly status: "error";
      readonly error: unknown;
      readonly hasCompleted: boolean;
    };

export type SystemBootstrapEvent =
  /** The provider was disabled: forget everything. */
  | { readonly type: "disable" }
  /** The inputs a run needs are not all available yet. */
  | { readonly type: "input-missing" }
  /** The current input's target already completed. */
  | { readonly type: "target-complete" }
  | { readonly type: "run-started"; readonly run: SystemBootstrapRunTag }
  | { readonly type: "run-succeeded"; readonly run: SystemBootstrapRunTag }
  /** The run finished without provisioning everything (e.g. no self contact). */
  | { readonly type: "run-incomplete"; readonly run: SystemBootstrapRunTag }
  | {
      readonly type: "run-failed";
      readonly run: SystemBootstrapRunTag;
      readonly error: unknown;
    }
  /**
   * The run finished after a newer input replaced the one it started from.
   * The newer input's own event drives the next state; when there is no newer
   * input to run (`inputMissing`), nothing else would leave `running`.
   */
  | {
      readonly type: "run-superseded";
      readonly run: SystemBootstrapRunTag;
      readonly inputMissing: boolean;
    };

const SYSTEM_BOOTSTRAP_IDLE: SystemBootstrapState = { status: "idle" };

export function initialSystemBootstrapState(
  enabled: boolean,
): SystemBootstrapState {
  return enabled
    ? { hasCompleted: false, status: "waiting" }
    : SYSTEM_BOOTSTRAP_IDLE;
}

export function hasSystemBootstrapCompleted(
  state: SystemBootstrapState,
): boolean {
  switch (state.status) {
    case "idle":
      return false;
    case "ready":
      return true;
    case "waiting":
    case "running":
    case "error":
      return state.hasCompleted;
    default:
      return assertNever(state);
  }
}

function waiting(state: SystemBootstrapState): SystemBootstrapState {
  const hasCompleted = hasSystemBootstrapCompleted(state);
  return state.status === "waiting" && state.hasCompleted === hasCompleted
    ? state
    : { hasCompleted, status: "waiting" };
}

function isCurrentRun(
  state: SystemBootstrapState,
  run: SystemBootstrapRunTag,
): state is Extract<SystemBootstrapState, { status: "running" }> {
  return state.status === "running" && state.run === run;
}

/**
 * Pure transition. Returns the same reference when an event changes nothing,
 * so React bails out of the re-render: the provider re-asserts
 * `target-complete` on every input identity change, and the input is rebuilt
 * on each store snapshot.
 */
export function transitionSystemBootstrap(
  state: SystemBootstrapState,
  event: SystemBootstrapEvent,
): SystemBootstrapState {
  switch (event.type) {
    case "disable":
      return state.status === "idle" ? state : SYSTEM_BOOTSTRAP_IDLE;
    case "input-missing":
      // A run in flight settles the state itself (run-superseded).
      return state.status === "running" ? state : waiting(state);
    case "target-complete":
      return state.status === "ready" ? state : { status: "ready" };
    case "run-started":
      return isCurrentRun(state, event.run)
        ? state
        : {
            hasCompleted: hasSystemBootstrapCompleted(state),
            run: event.run,
            status: "running",
          };
    case "run-succeeded":
      return isCurrentRun(state, event.run) ? { status: "ready" } : state;
    case "run-incomplete":
      return isCurrentRun(state, event.run) ? waiting(state) : state;
    case "run-failed":
      return isCurrentRun(state, event.run)
        ? {
            error: event.error,
            hasCompleted: state.hasCompleted,
            status: "error",
          }
        : state;
    case "run-superseded":
      return isCurrentRun(state, event.run) && event.inputMissing
        ? waiting(state)
        : state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled system bootstrap value: ${JSON.stringify(value)}`);
}
