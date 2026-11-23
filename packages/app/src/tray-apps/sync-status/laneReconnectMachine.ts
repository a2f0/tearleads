import type { DomainSyncSnapshot } from "@tearleads/client-sdk";
import { type LaneFailureMarks, markLaneFailures } from "./syncActivityModel";

/**
 * Whether the device is online, and which lane failures it carried back from
 * being offline. Lanes fail while offline as a matter of course, and a lane
 * keeps its error until a later run completes, so without this the tray would
 * flash its warning on every reconnect for failures that the reconnect is
 * about to retry. A failure recorded after the reconnect is a new one.
 */
export type LaneReconnectState =
  | { readonly status: "offline" }
  | {
      /** Failures recorded when the device came back online. */
      readonly staleFailures: LaneFailureMarks;
      readonly status: "online";
    };

export interface LaneReconnectEvent {
  readonly online: boolean;
  readonly snapshot: DomainSyncSnapshot;
  readonly type: "observed";
}

const OFFLINE: LaneReconnectState = { status: "offline" };

// Online from the start: whatever failed was not caused by being offline here.
const ONLINE_FROM_START: LaneReconnectState = {
  staleFailures: new Map(),
  status: "online",
};

export function initialLaneReconnectState(online: boolean): LaneReconnectState {
  return online ? ONLINE_FROM_START : OFFLINE;
}

/** Returns `state` itself when nothing changed. */
export function transitionLaneReconnect(
  state: LaneReconnectState,
  event: LaneReconnectEvent,
): LaneReconnectState {
  switch (state.status) {
    case "offline":
      return event.online
        ? {
            staleFailures: markLaneFailures(event.snapshot),
            status: "online",
          }
        : state;
    case "online":
      return event.online ? state : OFFLINE;
  }
}
