import type { DocumentSummary } from "@tearleads/client-sdk";

/**
 * Saving the version on screen as a new document, tagged with the request
 * that started it.
 *
 * - `idle`: nothing asked.
 * - `confirming`: the user asked to copy stop `index` and must confirm.
 * - `saving`: the new document is being created.
 * - `saved`: `copy` is the document that was created.
 * - `refused`: the last copy was not created (the folder no longer takes it,
 *   or the request was superseded).
 */
export type DocumentHistoryCopyState =
  | { readonly status: "idle" }
  | { readonly index: number; readonly status: "confirming" }
  | {
      readonly index: number;
      readonly run: number;
      readonly status: "saving";
    }
  | { readonly copy: DocumentSummary; readonly status: "saved" }
  | { readonly status: "refused" };

export type DocumentHistoryCopyEvent =
  | { readonly index: number; readonly type: "requested" }
  | { readonly type: "cancelled" }
  | { readonly run: number; readonly type: "confirmed" }
  | {
      /** The document that was created, or null when none was. */
      readonly copy: DocumentSummary | null;
      readonly run: number;
      readonly type: "finished";
    }
  /** The user moved to another stop: the outcome no longer describes it. */
  | { readonly type: "stop-changed" };

export const IDLE_DOCUMENT_HISTORY_COPY: DocumentHistoryCopyState = {
  status: "idle",
};

/**
 * Pure transition; returns the same reference for ignored events. Only the
 * current run may finish a copy, and a copy in flight cannot be cancelled or
 * replaced: its document may already exist.
 *
 * | state \ event | requested  | cancelled | confirmed | finished (run)   | stop-changed |
 * | ------------- | ---------- | --------- | --------- | ---------------- | ------------ |
 * | idle          | confirming | (same)    | (same)    | (same)           | (same)       |
 * | confirming    | confirming | idle      | saving    | (same)           | idle         |
 * | saving        | (same)     | (same)    | (same)    | saved or refused | (same)       |
 * | saved         | confirming | idle      | (same)    | (same)           | idle         |
 * | refused       | confirming | idle      | (same)    | (same)           | idle         |
 */
export function transitionDocumentHistoryCopy(
  state: DocumentHistoryCopyState,
  event: DocumentHistoryCopyEvent,
): DocumentHistoryCopyState {
  if (state.status === "saving") {
    if (event.type !== "finished" || event.run !== state.run) return state;
    return event.copy === null
      ? { status: "refused" }
      : { copy: event.copy, status: "saved" };
  }
  switch (event.type) {
    case "requested":
      return { index: event.index, status: "confirming" };
    case "cancelled":
    case "stop-changed":
      return state.status === "idle" ? state : IDLE_DOCUMENT_HISTORY_COPY;
    case "confirmed":
      return state.status === "confirming"
        ? { index: state.index, run: event.run, status: "saving" }
        : state;
    default:
      return state;
  }
}
