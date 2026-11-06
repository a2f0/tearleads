/**
 * Phase of one document-summary directory subscription's load loop.
 *
 * - `idle`: no query in flight.
 * - `loading`: one query in flight, and nothing has asked for another.
 * - `loading-with-reload`: one query in flight, and a discovery or a live
 *   write arrived since it started, so the loop runs the query again.
 * - `disposed`: unsubscribed; every event is ignored.
 *
 * Replaces the `active` + `loading` + `reloadRequested` flags, whose
 * combinations without a query in flight (a reload queued while idle, a
 * loading loop after disposal) meant nothing.
 */
export type DocumentSummaryDirectoryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "loading-with-reload" }
  | { readonly status: "disposed" };

export type DocumentSummaryDirectoryEvent =
  /** `load()` was called: start the loop, or queue one more pass. */
  | { readonly type: "load-requested" }
  /** A live write landed; an in-flight query must run again. */
  | { readonly type: "persisted" }
  /** The loop begins a pass, consuming any queued reload. */
  | { readonly type: "pass-started" }
  /** The loop exited (no reload queued, or the subscription is stale). */
  | { readonly type: "loop-finished" }
  | { readonly type: "disposed" };

export const DIRECTORY_IDLE: DocumentSummaryDirectoryState = { status: "idle" };
const LOADING: DocumentSummaryDirectoryState = { status: "loading" };
const LOADING_WITH_RELOAD: DocumentSummaryDirectoryState = {
  status: "loading-with-reload",
};
const DISPOSED: DocumentSummaryDirectoryState = { status: "disposed" };

/**
 * Pure transition; returns the same reference for events that change nothing.
 *
 * | state \ event       | load-requested      | persisted           | pass-started | loop-finished | disposed |
 * | ------------------- | ------------------- | ------------------- | ------------ | ------------- | -------- |
 * | idle                | loading             | (same)              | (same)       | (same)        | disposed |
 * | loading             | loading-with-reload | loading-with-reload | (same)       | idle          | disposed |
 * | loading-with-reload | (same)              | (same)              | loading      | idle          | disposed |
 * | disposed            | (same)              | (same)              | (same)       | (same)        | (same)   |
 */
export function transitionDocumentSummaryDirectory(
  state: DocumentSummaryDirectoryState,
  event: DocumentSummaryDirectoryEvent,
): DocumentSummaryDirectoryState {
  if (state.status === "disposed") return state;
  switch (event.type) {
    case "load-requested":
      return state.status === "idle" ? LOADING : queueReload(state);
    case "persisted":
      return queueReload(state);
    case "pass-started":
      return state.status === "loading-with-reload" ? LOADING : state;
    case "loop-finished":
      return state.status === "idle" ? state : DIRECTORY_IDLE;
    case "disposed":
      return DISPOSED;
    default:
      return assertNever(event);
  }
}

function queueReload(
  state: DocumentSummaryDirectoryState,
): DocumentSummaryDirectoryState {
  return state.status === "loading" ? LOADING_WITH_RELOAD : state;
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled document summary directory event: ${JSON.stringify(value)}`,
  );
}
