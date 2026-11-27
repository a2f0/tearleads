import type { useDatabase } from "../db/DatabaseProvider";
import type { useTearleads } from "../sdk/TearleadsProvider";

/** The inputs one root container bootstrap ran for. */
export interface RootBootstrapAttempt {
  readonly signIn: () => boolean;
  readonly scope: ReturnType<typeof useTearleads>["domainScope"];
  readonly dbClient: ReturnType<typeof useDatabase>["client"];
  readonly signingFingerprint: string;
}

/**
 * The crypto session's root container bootstrap.
 *
 * `running` is wanted while the provider still needs a root container for its
 * attempt; it stops being wanted once a root container exists, the database
 * or signing key goes away, or the provider unmounts. A run the SQLite worker
 * kept refusing behind another tab's transaction waits in `waitingBusy`, then
 * runs again, since nothing the provider watches changes when that
 * transaction ends (#3360). `settled` keeps a finished attempt so the same
 * inputs never bootstrap twice.
 */
export type RootBootstrap =
  | { readonly status: "idle" }
  | {
      readonly status: "running";
      readonly attempt: RootBootstrapAttempt;
      readonly wanted: boolean;
    }
  | { readonly status: "waitingBusy"; readonly attempt: RootBootstrapAttempt }
  | { readonly status: "settled"; readonly attempt: RootBootstrapAttempt };

export type RootBootstrapEvent =
  /** The provider needs a root container for new inputs. */
  | { readonly type: "start"; readonly attempt: RootBootstrapAttempt }
  /** The provider still needs a root container for these inputs. */
  | { readonly type: "wanted"; readonly attempt: RootBootstrapAttempt }
  /** A root container exists, the database went away, or the provider unmounted. */
  | { readonly type: "lapse" }
  /** The signing key went away: the session starts over. */
  | { readonly type: "reset" }
  | { readonly type: "settled"; readonly attempt: RootBootstrapAttempt }
  | { readonly type: "busy"; readonly attempt: RootBootstrapAttempt }
  | { readonly type: "failed"; readonly attempt: RootBootstrapAttempt }
  | { readonly type: "busyPauseEnded"; readonly attempt: RootBootstrapAttempt };

const IDLE: RootBootstrap = { status: "idle" };

/** The attempt the bootstrap holds, if any. */
export function rootBootstrapAttempt(
  state: RootBootstrap,
): RootBootstrapAttempt | null {
  return state.status === "idle" ? null : state.attempt;
}

function onLapse(state: RootBootstrap): RootBootstrap {
  if (state.status === "running") return { ...state, wanted: false };
  return state.status === "waitingBusy" ? IDLE : state;
}

function onRunEnded(
  state: RootBootstrap,
  event: Extract<RootBootstrapEvent, { type: "settled" | "busy" | "failed" }>,
): RootBootstrap {
  // Only the attempt that is running can finish; a replaced one is ignored.
  if (state.status !== "running" || state.attempt !== event.attempt) {
    return state;
  }
  if (event.type === "settled") {
    return { status: "settled", attempt: state.attempt };
  }
  if (event.type === "busy" && state.wanted) {
    return { status: "waitingBusy", attempt: state.attempt };
  }
  return IDLE;
}

export function transitionRootBootstrap(
  state: RootBootstrap,
  event: RootBootstrapEvent,
): RootBootstrap {
  switch (event.type) {
    case "start":
      return { status: "running", attempt: event.attempt, wanted: true };
    case "wanted":
      return state.status === "running" &&
        state.attempt === event.attempt &&
        !state.wanted
        ? { ...state, wanted: true }
        : state;
    case "lapse":
      return onLapse(state);
    case "reset":
      return IDLE;
    case "settled":
    case "busy":
    case "failed":
      return onRunEnded(state, event);
    case "busyPauseEnded":
      return state.status === "waitingBusy" && state.attempt === event.attempt
        ? { status: "running", attempt: state.attempt, wanted: true }
        : state;
  }
}
