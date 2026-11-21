import type { DocumentSummary } from "@tearleads/client-sdk";

/**
 * Saving the version on screen as a new document, tagged with the request
 * that started it. Every state but `idle` names the stop it is shown on.
 *
 * - `idle`: nothing asked.
 * - `confirming`: the user asked to copy stop `index` and must confirm.
 * - `saving`: the new document is being created. `index` follows the stop on
 *   screen, so the outcome is reported there; it is null while no stop is
 *   shown, as when History reloads.
 * - `saved`: `copy` is the document that was created. A null `index` is an
 *   outcome no stop has shown yet: the next stop shown takes it.
 * - `refused`: the copy was not created: the folder stopped taking it, before
 *   or after it was confirmed, or creating it failed.
 */
export type DocumentHistoryCopyState =
  | { readonly status: "idle" }
  | { readonly index: number; readonly status: "confirming" }
  | {
      readonly index: number | null;
      readonly run: number;
      readonly status: "saving";
    }
  | {
      readonly copy: DocumentSummary;
      readonly index: number | null;
      readonly status: "saved";
    }
  | { readonly index: number | null; readonly status: "refused" };

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
  /**
   * The stop the control is showing, or null when it stops showing one (the
   * timeline is gone while History reloads). Sent whenever that changes: a
   * confirmation or an outcome raised on another stop no longer describes
   * this one.
   */
  | { readonly index: number | null; readonly type: "stop-shown" }
  /**
   * The copy stopped being offered for the version on screen: the folder no
   * longer takes it, or the viewer's Me is no longer known. A confirmation
   * that is open must say so rather than vanish and come back.
   */
  | { readonly type: "withdrawn" };

export const IDLE_DOCUMENT_HISTORY_COPY: DocumentHistoryCopyState = {
  status: "idle",
};

type SavingCopy = Extract<DocumentHistoryCopyState, { status: "saving" }>;
type SettledCopy = Exclude<DocumentHistoryCopyState, SavingCopy>;

/** A copy in flight follows the stop on screen and takes only its own finish. */
function transitionSavingCopy(
  state: SavingCopy,
  event: DocumentHistoryCopyEvent,
): DocumentHistoryCopyState {
  if (event.type === "stop-shown") {
    return event.index === state.index
      ? state
      : { ...state, index: event.index };
  }
  if (event.type !== "finished" || event.run !== state.run) return state;
  return event.copy === null
    ? { index: state.index, status: "refused" }
    : { copy: event.copy, index: state.index, status: "saved" };
}

/** What a state raised on one stop becomes when `index` is the stop shown. */
function showStop(
  state: SettledCopy,
  index: number | null,
): DocumentHistoryCopyState {
  if (state.status === "idle" || index === null || state.index === index) {
    return state;
  }
  // An outcome that arrived while no stop was shown is reported on the first
  // one that is.
  return state.index === null
    ? { ...state, index }
    : IDLE_DOCUMENT_HISTORY_COPY;
}

/**
 * Pure transition; returns the same reference for ignored events. Only the
 * current run may finish a copy, and a copy in flight cannot be cancelled or
 * replaced: its document may already exist.
 *
 * `stop-shown` is listed for another stop. For the state's own stop it
 * changes nothing; for no stop (null) it changes only `saving`, which stops
 * naming one; and an outcome no stop has shown yet takes the stop shown.
 *
 * | state \ event | requested  | cancelled | confirmed | finished (run)   | stop-shown (other) | withdrawn |
 * | ------------- | ---------- | --------- | --------- | ---------------- | ------------------ | --------- |
 * | idle          | confirming | (same)    | (same)    | (same)           | (same)             | (same)    |
 * | confirming    | confirming | idle      | saving    | (same)           | idle               | refused   |
 * | saving        | (same)     | (same)    | (same)    | saved or refused | saving, that stop  | (same)    |
 * | saved         | confirming | idle      | (same)    | (same)           | idle               | (same)    |
 * | refused       | confirming | idle      | (same)    | (same)           | idle               | (same)    |
 */
export function transitionDocumentHistoryCopy(
  state: DocumentHistoryCopyState,
  event: DocumentHistoryCopyEvent,
): DocumentHistoryCopyState {
  if (state.status === "saving") return transitionSavingCopy(state, event);
  switch (event.type) {
    case "requested":
      return { index: event.index, status: "confirming" };
    case "cancelled":
      return state.status === "idle" ? state : IDLE_DOCUMENT_HISTORY_COPY;
    case "stop-shown":
      return showStop(state, event.index);
    case "confirmed":
      return state.status === "confirming"
        ? { index: state.index, run: event.run, status: "saving" }
        : state;
    case "withdrawn":
      return state.status === "confirming"
        ? { index: state.index, status: "refused" }
        : state;
    default:
      return state;
  }
}
