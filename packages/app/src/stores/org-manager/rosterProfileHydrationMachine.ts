import type { RosterProfileBinding } from "./rosterProfileDisplayNames";

type Bindings = ReadonlyArray<RosterProfileBinding>;

/**
 * One roster load's pull of the profiles this device holds no row for.
 *
 * Only an admin can read the Roster Profiles container, so a member's load is
 * `disabled`. A load pulls at most once: a new member changes the binding key,
 * which starts a new load. A device that has not listed the container yet
 * waits for its container listing to change, then pulls. A listing change
 * during a pass is remembered, so a pass that found no container retries at
 * once instead of waiting for another change. A pass that stops at a profile
 * the SQLite worker kept refusing behind another tab's transaction waits a
 * moment, then pulls the profiles it did not reach (#3360). Each pass has its
 * own `attempt`.
 */
export type RosterProfileHydration =
  | { readonly status: "disabled" }
  | { readonly status: "idle" }
  | { readonly status: "awaitingContainer"; readonly bindings: Bindings }
  | {
      readonly status: "running";
      readonly attempt: number;
      readonly bindings: Bindings;
      readonly containersChanged: boolean;
    }
  | {
      readonly status: "waitingBusy";
      readonly attempt: number;
      readonly bindings: Bindings;
    }
  | { readonly status: "done" };

export type RosterProfileHydrationEvent =
  /** A load found roster profiles with no local row. */
  | { readonly type: "profilesMissing"; readonly bindings: Bindings }
  /** The device's container listing changed. */
  | { readonly type: "containersChanged" }
  /** The pass found no Roster Profiles container on this device. */
  | { readonly type: "containerMissing" }
  /** The pass tried every profile it was given. */
  | { readonly type: "finished" }
  /** The pass stopped at a busy refusal; `bindings` are what it did not reach. */
  | { readonly type: "busy"; readonly bindings: Bindings }
  /** The pause after a busy refusal ended. */
  | { readonly type: "busyPauseEnded" };

function running(attempt: number, bindings: Bindings): RosterProfileHydration {
  return { status: "running", attempt, bindings, containersChanged: false };
}

export function initialRosterProfileHydration(
  isOrgAdmin: boolean,
): RosterProfileHydration {
  return isOrgAdmin ? { status: "idle" } : { status: "disabled" };
}

function onProfilesMissing(
  state: RosterProfileHydration,
  bindings: Bindings,
): RosterProfileHydration {
  if (bindings.length === 0) return state;
  if (state.status === "idle") return running(0, bindings);
  // Keep the latest list: profiles may have arrived while waiting. A busy
  // pause keeps what its pass did not reach, so one load stays in its budget.
  return state.status === "awaitingContainer"
    ? { status: "awaitingContainer", bindings }
    : state;
}

function onContainersChanged(
  state: RosterProfileHydration,
): RosterProfileHydration {
  if (state.status === "awaitingContainer") {
    return running(0, state.bindings);
  }
  return state.status === "running"
    ? { ...state, containersChanged: true }
    : state;
}

function onContainerMissing(
  state: RosterProfileHydration,
): RosterProfileHydration {
  if (state.status !== "running") return state;
  return state.containersChanged
    ? running(state.attempt + 1, state.bindings)
    : { status: "awaitingContainer", bindings: state.bindings };
}

export function transitionRosterProfileHydration(
  state: RosterProfileHydration,
  event: RosterProfileHydrationEvent,
): RosterProfileHydration {
  switch (event.type) {
    case "profilesMissing":
      return onProfilesMissing(state, event.bindings);
    case "containersChanged":
      return onContainersChanged(state);
    case "containerMissing":
      return onContainerMissing(state);
    case "finished":
      return state.status === "running" ? { status: "done" } : state;
    case "busy":
      return state.status === "running"
        ? {
            status: "waitingBusy",
            attempt: state.attempt,
            bindings: event.bindings,
          }
        : state;
    case "busyPauseEnded":
      return state.status === "waitingBusy"
        ? running(state.attempt + 1, state.bindings)
        : state;
  }
}
