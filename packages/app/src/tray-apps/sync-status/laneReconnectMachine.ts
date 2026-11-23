import type { DomainSyncSnapshot } from "@tearleads/client-sdk";
import type { OfflineWindow } from "./syncActivityModel";

/**
 * Whether the device is online, and when it was last offline. Lanes fail
 * while offline as a matter of course, and a failed lane keeps its error
 * until a later run completes, so without this the tray would flash its
 * warning on every reconnect for failures that a queued retry is about to
 * revisit. Times come from the sync snapshot, not a clock (see
 * `OfflineWindow`), so the transition stays pure.
 */
export type LaneReconnectState =
  | {
      /** The latest snapshot time before the device went offline. */
      readonly offlineSince: string;
      readonly status: "offline";
    }
  | {
      /** When the device was last offline; null if it has not been. */
      readonly offlineWindow: OfflineWindow | null;
      readonly status: "online";
    };

export interface LaneReconnectEvent {
  readonly online: boolean;
  readonly snapshot: DomainSyncSnapshot;
  readonly type: "observed";
}

/**
 * Mounting offline counts failures recorded before the mount as recorded
 * online: nothing here says they were not, so they are reported.
 */
export function initialLaneReconnectState(
  online: boolean,
  snapshot: DomainSyncSnapshot,
): LaneReconnectState {
  return online
    ? { offlineWindow: null, status: "online" }
    : { offlineSince: snapshot.updatedAt, status: "offline" };
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
            offlineWindow: {
              from: state.offlineSince,
              to: event.snapshot.updatedAt,
            },
            status: "online",
          }
        : state;
    case "online":
      return event.online
        ? state
        : { offlineSince: event.snapshot.updatedAt, status: "offline" };
  }
}
