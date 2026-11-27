import {
  type ConnectAttemptWait,
  NO_CONNECT_ATTEMPT_WAIT,
  transitionConnectAttemptWait,
} from "../../../../workflows/shared/connectAttemptWaitMachine";

/**
 * Whether a store's openers want the one remote probe an opened document
 * needs after a restart, and whether that probe is waiting on a connect
 * attempt. See `startupProbeDeferral.ts` for why it waits; whether it waits
 * is decided by `connectAttemptWaitMachine.ts`, as for the other work an
 * acknowledgement does.
 *
 * | state      | event            | condition                             | next          | arm |
 * | ---------- | ---------------- | ------------------------------------- | ------------- | --- |
 * | onDemand   | joined           | not loaded, or no probe owed          | wanted        | no  |
 * | onDemand   | joined           | probe owed, connect attempt `a` open  | deferred(a)   | no  |
 * | onDemand   | joined           | probe owed, no connect attempt        | wanted        | yes |
 * | onDemand   | loaded           |                                       | onDemand      | no  |
 * | wanted     | loaded           | local-only record, or one a listing covers | wanted   | no  |
 * | wanted     | loaded           | connect attempt `a` open              | deferred(a)   | no  |
 * | wanted     | loaded           | no connect attempt                    | wanted        | yes |
 * | deferred   | loaded           | local-only record, or one a listing covers | deferred | no  |
 * | deferred   | loaded           | connect attempt `a` open              | deferred(a)   | no  |
 * | deferred   | loaded           | no connect attempt                    | wanted        | yes |
 * | deferred(a)| runtimeInstalled | attempt `a` still open                | deferred(a)   | no  |
 * | deferred(a)| runtimeInstalled | `a` settled, server events reconnected | wanted       | no  |
 * | deferred   | runtimeInstalled | otherwise                             | wanted        | yes |
 * | deferred   | reset            |                                       | wanted        | no  |
 *
 * Every other pair leaves the state unchanged and arms nothing: a second join,
 * a runtime installed with no deferred probe, a reset that had nothing to
 * forget. A probe is "owed" to a loaded remote record whose remote sync is
 * still blocked; one already allowed (a requested sync, a server hint) covers
 * it, and so does a container listing (`listingCoverage.ts`): after every
 * acknowledged connection the scope lists the record's lane if it moved and
 * owes a read to a document that moved, so a covered record never probes on
 * its own. "wanted" stays after arming: it says the next load probes again. A
 * store loads again only after a reset, which leaves "deferred", so the
 * deferred load rows keep the old behavior for a load that does not happen.
 * An acknowledgement settles the attempt it acknowledges in the same runtime
 * snapshot (`setConnected(true)`), so a reconnect never arrives while that
 * attempt is still open.
 */
export type StartupProbeState =
  | { readonly status: "onDemand" }
  | { readonly status: "wanted" }
  | { readonly status: "deferred"; readonly attempt: number };

export type StartupProbeEvent =
  /** A startup-mode open joined a store an on-demand open created. */
  | {
      readonly type: "joined";
      readonly pendingConnectAttempt: number | undefined;
      readonly probeOwed: boolean;
    }
  /** Initialization loaded the record. */
  | {
      readonly type: "loaded";
      /** A container listing vouches for the record; see `listingCoverage.ts`. */
      readonly covered: boolean;
      readonly pendingConnectAttempt: number | undefined;
      readonly remote: boolean;
    }
  /** A loaded store installed a new runtime. */
  | {
      readonly type: "runtimeInstalled";
      readonly pendingConnectAttempt: number | undefined;
      readonly reconnected: boolean;
    }
  /** The store dropped its loaded state and will load again. */
  | { readonly type: "reset" };

export interface StartupProbeTransition {
  /** Run the startup probe now (allow remote sync and queue it). */
  readonly arm: boolean;
  readonly state: StartupProbeState;
}

const WANTED: StartupProbeState = { status: "wanted" };
/** What a deferred probe waits to do: run. */
const PROBE = "probe" as const;

function stay(state: StartupProbeState): StartupProbeTransition {
  return { arm: false, state };
}

// The probe's state once the wait moved: still deferred to its attempt,
// handed to the reconnect probe the acknowledgement arms (which covers
// strictly more), or run because no reconnect probe will come.
function afterWait(
  wait: ConnectAttemptWait<typeof PROBE>,
  released: typeof PROBE | undefined,
): StartupProbeTransition {
  if (wait.status === "waiting") {
    return { arm: false, state: { attempt: wait.attempt, status: "deferred" } };
  }
  return released ? { arm: true, state: WANTED } : stay(WANTED);
}

// A probe owed now either waits on the open connect attempt or runs.
function runOrDefer(
  pendingConnectAttempt: number | undefined,
): StartupProbeTransition {
  const next = transitionConnectAttemptWait(NO_CONNECT_ATTEMPT_WAIT, {
    pendingConnectAttempt,
    request: PROBE,
    type: "hold",
  });
  return afterWait(next.state, next.released);
}

// A deferred probe the new runtime settles.
function settleDeferred(
  state: StartupProbeState,
  event: Extract<StartupProbeEvent, { type: "runtimeInstalled" }>,
): StartupProbeTransition {
  if (state.status !== "deferred") return stay(state);
  const next = transitionConnectAttemptWait(
    { attempt: state.attempt, request: PROBE, status: "waiting" },
    {
      acknowledged: event.reconnected,
      pendingConnectAttempt: event.pendingConnectAttempt,
      type: "observe",
    },
  );
  return afterWait(next.state, next.released);
}

export function initialStartupProbeState(
  remoteSyncMode: "on-demand" | "startup",
): StartupProbeState {
  return remoteSyncMode === "startup" ? WANTED : { status: "onDemand" };
}

export function transitionStartupProbe(
  state: StartupProbeState,
  event: StartupProbeEvent,
): StartupProbeTransition {
  switch (event.type) {
    case "joined":
      if (state.status !== "onDemand") return stay(state);
      return event.probeOwed
        ? runOrDefer(event.pendingConnectAttempt)
        : stay(WANTED);
    case "loaded":
      if (state.status === "onDemand" || !event.remote || event.covered) {
        return stay(state);
      }
      return runOrDefer(event.pendingConnectAttempt);
    case "runtimeInstalled":
      return settleDeferred(state, event);
    case "reset":
      return stay(state.status === "deferred" ? WANTED : state);
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** The `reset` event's next state, for a store dropping its loaded state. */
export function resetStartupProbe(state: StartupProbeState): StartupProbeState {
  return transitionStartupProbe(state, { type: "reset" }).state;
}
