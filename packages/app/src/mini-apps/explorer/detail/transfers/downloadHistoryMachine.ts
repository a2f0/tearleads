import type {
  CompletedDownloadItem,
  DownloadQueueItemRef,
  PendingDownloadQueueItem,
} from "@tearleads/client-sdk";

/**
 * One Downloads row: a pull still in the SDK's queue, or one that left it and
 * the SDK confirmed fully stored. A row that leaves the queue unconfirmed
 * (deleted, detached, reset) is dropped rather than shown as complete. A
 * completed row keeps its queue row's identity and file name, with the title
 * the stored content supplied and no error.
 */
export type DownloadHistoryEntry =
  | { readonly item: PendingDownloadQueueItem; readonly status: "pending" }
  | { readonly item: PendingDownloadQueueItem; readonly status: "complete" };

/**
 * The Downloads history for one domain scope, tagged with the newest queue
 * read so only that read may settle it.
 *
 * - `loading`: the queue has not been read in this scope yet.
 * - `ready`: the newest settled read succeeded.
 * - `failed`: the newest settled read threw; `entries` keeps the last rows.
 *
 * Entries list pending rows in queue order, then completed rows, newest first.
 */
export type DownloadHistoryState =
  | { readonly read: number; readonly status: "loading" }
  | {
      readonly entries: ReadonlyArray<DownloadHistoryEntry>;
      readonly read: number;
      readonly status: "ready";
    }
  | {
      readonly entries: ReadonlyArray<DownloadHistoryEntry>;
      readonly message: string;
      readonly read: number;
      readonly status: "failed";
    };

export type DownloadHistoryEvent =
  | { readonly read: number; readonly type: "read-started" }
  | {
      /** The departed rows the SDK confirmed fully stored. */
      readonly completed: ReadonlyArray<CompletedDownloadItem>;
      readonly pending: ReadonlyArray<PendingDownloadQueueItem>;
      readonly read: number;
      readonly type: "read-finished";
    }
  | {
      readonly message: string;
      readonly read: number;
      readonly type: "read-failed";
    };

// The newest completed rows kept, so a large first hydration cannot grow the
// history without bound; pending rows are never dropped.
const MAX_COMPLETED_DOWNLOADS = 2000;

export const INITIAL_DOWNLOAD_HISTORY: DownloadHistoryState = {
  read: 0,
  status: "loading",
};

export function getDownloadHistoryKey(ref: DownloadQueueItemRef): string {
  return ref.objectKind === "attachment"
    ? `attachment:${ref.localId}:${ref.slotId}`
    : `${ref.objectKind}:${ref.localId}`;
}

function getDownloadQueueItemRef(
  item: PendingDownloadQueueItem,
): DownloadQueueItemRef {
  return item.objectKind === "attachment"
    ? { localId: item.localId, objectKind: "attachment", slotId: item.slotId }
    : { localId: item.localId, objectKind: item.objectKind };
}

function completeDownloadItem(
  pending: PendingDownloadQueueItem,
  confirmed: CompletedDownloadItem,
): PendingDownloadQueueItem {
  if (pending.objectKind === "attachment")
    return {
      ...pending,
      lastError: null,
      title:
        confirmed.objectKind === "attachment" ? confirmed.title : pending.title,
    };
  return {
    ...pending,
    lastError: null,
    title: confirmed.title ?? pending.title,
  };
}

const NO_DOWNLOAD_ENTRIES: ReadonlyArray<DownloadHistoryEntry> = [];

export function getDownloadHistoryEntries(
  state: DownloadHistoryState,
): ReadonlyArray<DownloadHistoryEntry> {
  return state.status === "loading" ? NO_DOWNLOAD_ENTRIES : state.entries;
}

/** The rows this state shows pending that a fresh queue read no longer lists. */
export function getDepartedDownloads(
  state: DownloadHistoryState,
  pending: ReadonlyArray<PendingDownloadQueueItem>,
): ReadonlyArray<DownloadQueueItemRef> {
  const stillPending = new Set(pending.map(getDownloadHistoryKey));
  return getDownloadHistoryEntries(state).flatMap((entry) =>
    entry.status === "pending" &&
    !stillPending.has(getDownloadHistoryKey(entry.item))
      ? [getDownloadQueueItemRef(entry.item)]
      : [],
  );
}

/**
 * A queue read replaces the pending rows. A departed pending row becomes
 * complete when the read confirmed it and is dropped otherwise. A completed
 * row stays until scope teardown, unless it re-enters the queue, which makes
 * it pending again so it is listed once, or it falls past the newest
 * `MAX_COMPLETED_DOWNLOADS`.
 */
function settleEntries(
  previous: ReadonlyArray<DownloadHistoryEntry>,
  event: Extract<DownloadHistoryEvent, { type: "read-finished" }>,
): ReadonlyArray<DownloadHistoryEntry> {
  const pendingKeys = new Set(event.pending.map(getDownloadHistoryKey));
  const confirmed = new Map(
    event.completed.map((item) => [getDownloadHistoryKey(item), item]),
  );
  const newlyComplete: DownloadHistoryEntry[] = [];
  const retainedComplete: DownloadHistoryEntry[] = [];
  for (const entry of previous) {
    const key = getDownloadHistoryKey(entry.item);
    if (pendingKeys.has(key)) continue;
    if (entry.status === "complete") {
      retainedComplete.push(entry);
      continue;
    }
    const stored = confirmed.get(key);
    if (stored)
      newlyComplete.push({
        item: completeDownloadItem(entry.item, stored),
        status: "complete",
      });
  }
  return [
    ...event.pending.map(
      (item): DownloadHistoryEntry => ({ item, status: "pending" }),
    ),
    ...[...newlyComplete, ...retainedComplete].slice(
      0,
      MAX_COMPLETED_DOWNLOADS,
    ),
  ];
}

/**
 * Pure transition; returns the same reference for ignored events. A read
 * starting does not change what the panel shows. Only the newest read may
 * settle the state.
 *
 * | state \ event | read-started   | read-finished (newest) | read-failed (newest) |
 * | ------------- | -------------- | ---------------------- | -------------------- |
 * | loading       | loading (read) | ready                  | failed, no entries   |
 * | ready         | ready (read)   | ready                  | failed, same entries |
 * | failed        | failed (read)  | ready                  | failed, same entries |
 */
export function transitionDownloadHistory(
  state: DownloadHistoryState,
  event: DownloadHistoryEvent,
): DownloadHistoryState {
  switch (event.type) {
    case "read-started":
      return event.read > state.read ? { ...state, read: event.read } : state;
    case "read-finished":
      return event.read === state.read
        ? {
            entries: settleEntries(getDownloadHistoryEntries(state), event),
            read: event.read,
            status: "ready",
          }
        : state;
    case "read-failed":
      return event.read === state.read
        ? {
            entries: getDownloadHistoryEntries(state),
            message: event.message,
            read: event.read,
            status: "failed",
          }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
