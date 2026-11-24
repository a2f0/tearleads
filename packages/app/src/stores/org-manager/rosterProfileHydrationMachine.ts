import type { RosterProfileBinding } from "./rosterProfileDisplayNames";

type Bindings = ReadonlyArray<RosterProfileBinding>;

/**
 * One roster load's pull of the profiles this device holds no row for.
 *
 * Only an admin can read the Roster Profiles container, so a member's load is
 * `disabled`. A load pulls at most once: a new member changes the binding key,
 * which starts a new load. A device that has not listed the container yet
 * waits for its container listing to change, then pulls.
 */
export type RosterProfileHydration =
  | { readonly status: "disabled" }
  | { readonly status: "idle" }
  | { readonly status: "awaitingContainer"; readonly bindings: Bindings }
  | { readonly status: "running"; readonly bindings: Bindings }
  | { readonly status: "done" };

export type RosterProfileHydrationEvent =
  /** A load found roster profiles with no local row. */
  | { readonly type: "profilesMissing"; readonly bindings: Bindings }
  /** The device's container listing changed. */
  | { readonly type: "containersChanged" }
  /** The pass found no Roster Profiles container on this device. */
  | { readonly type: "containerMissing" }
  /** The pass tried every profile it was given. */
  | { readonly type: "finished" };

export function initialRosterProfileHydration(
  isOrgAdmin: boolean,
): RosterProfileHydration {
  return isOrgAdmin ? { status: "idle" } : { status: "disabled" };
}

export function transitionRosterProfileHydration(
  state: RosterProfileHydration,
  event: RosterProfileHydrationEvent,
): RosterProfileHydration {
  switch (event.type) {
    case "profilesMissing":
      if (event.bindings.length === 0) return state;
      if (state.status === "idle") {
        return { status: "running", bindings: event.bindings };
      }
      // Keep the latest list: profiles may have arrived while waiting.
      if (state.status === "awaitingContainer") {
        return { status: "awaitingContainer", bindings: event.bindings };
      }
      return state;
    case "containersChanged":
      return state.status === "awaitingContainer"
        ? { status: "running", bindings: state.bindings }
        : state;
    case "containerMissing":
      return state.status === "running"
        ? { status: "awaitingContainer", bindings: state.bindings }
        : state;
    case "finished":
      return state.status === "running" ? { status: "done" } : state;
  }
}
