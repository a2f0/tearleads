/**
 * Whether a store's openers want the one remote probe an opened document
 * needs after a restart, and whether that probe is waiting on a connect
 * attempt. See `startupProbeDeferral.ts` for why it waits.
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
 * | deferred   | runtimeInstalled | server events reconnected             | wanted        | no  |
 * | deferred(a)| runtimeInstalled | attempt `a` still open                | deferred(a)   | no  |
 * | deferred   | runtimeInstalled | otherwise                             | wanted        | yes |
 * | deferred   | reset            |                                       | wanted        | no  |
 *
 * Every other pair leaves the state unchanged and arms nothing: a second join,
 * a runtime installed with no deferred probe, a reset that had nothing to
 * forget. A probe is "owed" to a loaded remote record whose remote sync is
 * still blocked; one already allowed (a requested sync, a server hint) covers
 * it, and so does a container listing (`listingCoverage.ts`): the scope lists
 * the record's lane after every acknowledged connection and owes a read to a
 * document that moved, so a covered record never probes on its own. "wanted" stays after arming: it says the next load probes again. A
 * store loads again only after a reset, which leaves "deferred", so the
 * deferred load rows keep the old behavior for a load that does not happen.
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

function stay(state: StartupProbeState): StartupProbeTransition {
  return { arm: false, state };
}

// A probe owed now either waits on the open connect attempt, whose
// acknowledgement arms a reconnect probe that covers it, or runs.
function runOrDefer(
  pendingConnectAttempt: number | undefined,
): StartupProbeTransition {
  return pendingConnectAttempt === undefined
    ? { arm: true, state: WANTED }
    : {
        arm: false,
        state: { attempt: pendingConnectAttempt, status: "deferred" },
      };
}

// A deferred probe the new runtime settles: handed to the reconnect probe,
// still waiting on its attempt, or run because no reconnect probe will come.
function settleDeferred(
  state: StartupProbeState,
  event: Extract<StartupProbeEvent, { type: "runtimeInstalled" }>,
): StartupProbeTransition {
  if (state.status !== "deferred") return stay(state);
  if (event.reconnected) return stay(WANTED);
  if (event.pendingConnectAttempt === state.attempt) return stay(state);
  return { arm: true, state: WANTED };
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
