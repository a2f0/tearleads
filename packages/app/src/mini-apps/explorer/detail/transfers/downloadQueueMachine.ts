import type { PendingDownloadQueueItem } from "@tearleads/client-sdk";

/**
 * The SDK's durable download queue as Downloads last read it in one domain
 * scope, tagged with the newest read so only that read may settle it.
 *
 * - `loading`: the queue has not been read in this scope yet.
 * - `ready`: the newest settled read succeeded.
 * - `failed`: the newest settled read threw; `pending` keeps the last rows.
 */
export type DownloadQueueState =
  | { readonly read: number; readonly status: "loading" }
  | {
      readonly pending: ReadonlyArray<PendingDownloadQueueItem>;
      readonly read: number;
      readonly status: "ready";
    }
  | {
      readonly message: string;
      readonly pending: ReadonlyArray<PendingDownloadQueueItem>;
      readonly read: number;
      readonly status: "failed";
    };

export type DownloadQueueEvent =
  | { readonly read: number; readonly type: "read-started" }
  | {
      readonly pending: ReadonlyArray<PendingDownloadQueueItem>;
      readonly read: number;
      readonly type: "read-finished";
    }
  | {
      readonly message: string;
      readonly read: number;
      readonly type: "read-failed";
    };

export const INITIAL_DOWNLOAD_QUEUE: DownloadQueueState = {
  read: 0,
  status: "loading",
};

const NO_PENDING_DOWNLOADS: ReadonlyArray<PendingDownloadQueueItem> = [];

export function getPendingDownloads(
  state: DownloadQueueState,
): ReadonlyArray<PendingDownloadQueueItem> {
  return state.status === "loading" ? NO_PENDING_DOWNLOADS : state.pending;
}

/**
 * Pure transition; returns the same reference for ignored events. A read
 * starting does not change what the panel shows. Only the newest read may
 * settle the state.
 *
 * | state \ event | read-started   | read-finished (newest) | read-failed (newest) |
 * | ------------- | -------------- | ---------------------- | -------------------- |
 * | loading       | loading (read) | ready                  | failed, no rows      |
 * | ready         | ready (read)   | ready                  | failed, same rows    |
 * | failed        | failed (read)  | ready                  | failed, same rows    |
 */
export function transitionDownloadQueue(
  state: DownloadQueueState,
  event: DownloadQueueEvent,
): DownloadQueueState {
  switch (event.type) {
    case "read-started":
      return event.read > state.read ? { ...state, read: event.read } : state;
    case "read-finished":
      return event.read === state.read
        ? { pending: event.pending, read: event.read, status: "ready" }
        : state;
    case "read-failed":
      return event.read === state.read
        ? {
            message: event.message,
            pending: getPendingDownloads(state),
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
