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

/**
 * How long before the browser reports a drop the drop may already be failing
 * requests: the connection goes, fetches in flight fail and record their
 * lanes' failures, and the `offline` event follows. Failures that close to the
 * drop count as offline ones too. Leaving one out lasts only while its retry
 * is queued or running, so a real failure returns when that retry fails.
 */
const OFFLINE_DETECTION_GRACE_MS = 5_000;

function beforeDetection(snapshotTime: string): string {
  const time = Date.parse(snapshotTime);
  return Number.isNaN(time)
    ? snapshotTime
    : new Date(time - OFFLINE_DETECTION_GRACE_MS).toISOString();
}

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
              from: beforeDetection(state.offlineSince),
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
