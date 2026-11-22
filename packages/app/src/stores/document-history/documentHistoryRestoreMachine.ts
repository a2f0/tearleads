/**
 * Restoring the version on screen, tagged with the request that started it.
 *
 * - `idle`: nothing asked.
 * - `confirming`: the user asked to restore stop `index` and must confirm.
 *   `versionTime` is the version's time as shown when they asked, which the
 *   confirmation names for as long as it is open.
 * - `restoring`: the write is in flight.
 * - `refused`: the last restore did not persist (the document could not be
 *   written, or the request was superseded).
 */
export type DocumentHistoryRestoreState =
  | { readonly status: "idle" }
  | {
      readonly index: number;
      readonly status: "confirming";
      /** Null when the time was not known yet. */
      readonly versionTime: string | null;
    }
  | {
      readonly index: number;
      readonly run: number;
      readonly status: "restoring";
    }
  | { readonly status: "refused" };

export type DocumentHistoryRestoreEvent =
  | {
      readonly index: number;
      readonly type: "requested";
      readonly versionTime: string | null;
    }
  | { readonly type: "cancelled" }
  | { readonly run: number; readonly type: "confirmed" }
  | {
      readonly restored: boolean;
      readonly run: number;
      readonly type: "finished";
    }
  /** The user moved to another stop: a refusal no longer describes it. */
  | { readonly type: "stop-changed" };

export const IDLE_DOCUMENT_HISTORY_RESTORE: DocumentHistoryRestoreState = {
  status: "idle",
};

/**
 * Pure transition; returns the same reference for ignored events. Only the
 * current run may finish a restore, and a restore in flight cannot be
 * cancelled or replaced.
 *
 * | state \ event | requested  | cancelled | confirmed | finished (run)    | stop-changed |
 * | ------------- | ---------- | --------- | --------- | ----------------- | ------------ |
 * | idle          | confirming | (same)    | (same)    | (same)            | (same)       |
 * | confirming    | confirming | idle      | restoring | (same)            | idle         |
 * | restoring     | (same)     | (same)    | (same)    | idle or refused   | (same)       |
 * | refused       | confirming | idle      | (same)    | (same)            | idle         |
 */
export function transitionDocumentHistoryRestore(
  state: DocumentHistoryRestoreState,
  event: DocumentHistoryRestoreEvent,
): DocumentHistoryRestoreState {
  if (state.status === "restoring") {
    if (event.type !== "finished" || event.run !== state.run) return state;
    return event.restored
      ? IDLE_DOCUMENT_HISTORY_RESTORE
      : { status: "refused" };
  }
  switch (event.type) {
    case "requested":
      return {
        index: event.index,
        status: "confirming",
        versionTime: event.versionTime,
      };
    case "cancelled":
    case "stop-changed":
      return state.status === "idle" ? state : IDLE_DOCUMENT_HISTORY_RESTORE;
    case "confirmed":
      return state.status === "confirming"
        ? { index: state.index, run: event.run, status: "restoring" }
        : state;
    default:
      return state;
  }
}
