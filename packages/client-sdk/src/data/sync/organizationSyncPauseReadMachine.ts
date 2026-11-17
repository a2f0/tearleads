/**
 * The read of a scope's persisted organization sync pauses. The sync lanes
 * read the pauses from memory, so whether memory reflects storage decides
 * whether they may sync at all: a device that failed to read its pauses
 * cannot tell which organizations to hold, and holds them all until a read
 * succeeds. `read` carries the settled read so later callers share it.
 */
export type OrganizationSyncPauseRead =
  | { readonly status: "unread" }
  | {
      readonly status: "reading";
      readonly read: Promise<void>;
      /** The read before this one failed, so sync is still held. */
      readonly afterFailure: boolean;
    }
  | { readonly status: "read"; readonly read: Promise<void> }
  | { readonly status: "failed" };

export type OrganizationSyncPauseReadEvent =
  | { readonly type: "start"; readonly read: Promise<void> }
  | { readonly type: "succeed" }
  | { readonly type: "fail" };

export const UNREAD_ORGANIZATION_SYNC_PAUSES: OrganizationSyncPauseRead = {
  status: "unread",
};

/** Whether the pauses in memory may be stale because a read failed. */
export function organizationSyncPausesUnreadable(
  state: OrganizationSyncPauseRead,
): boolean {
  return (
    state.status === "failed" ||
    (state.status === "reading" && state.afterFailure)
  );
}

export function transitionOrganizationSyncPauseRead(
  state: OrganizationSyncPauseRead,
  event: OrganizationSyncPauseReadEvent,
): OrganizationSyncPauseRead {
  switch (event.type) {
    case "start":
      // A read in flight or settled is shared, never restarted.
      return state.status === "unread" || state.status === "failed"
        ? {
            afterFailure: state.status === "failed",
            read: event.read,
            status: "reading",
          }
        : state;
    case "succeed":
      return state.status === "reading"
        ? { read: state.read, status: "read" }
        : state;
    case "fail":
      // Dropping the read lets a later call retry it.
      return state.status === "reading" ? { status: "failed" } : state;
  }
}
