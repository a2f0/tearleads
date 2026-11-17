import type { DocumentSummary } from "@tearleads/client-sdk";

/**
 * The summary of a document a route names by local id, tagged with the load
 * that asked for it.
 *
 * - `loading`: the loader has been asked and has not answered.
 * - `loaded`: the summary is known, from the caller or the loader.
 * - `missing`: the loader answered with none. The document is not hydrated on
 *   this device yet, or the route was refused it; a later load may differ.
 * - `failed`: the loader threw.
 */
export type DocumentSummaryLoadState =
  | { readonly request: number; readonly status: "loading" }
  | { readonly documentSummary: DocumentSummary; readonly status: "loaded" }
  | { readonly request: number; readonly status: "missing" }
  | {
      readonly message: string;
      readonly request: number;
      readonly status: "failed";
    };

export type DocumentSummaryLoadEvent =
  /** The caller already holds the document's summary. */
  | { readonly documentSummary: DocumentSummary; readonly type: "known" }
  | { readonly request: number; readonly type: "load-started" }
  | {
      readonly documentSummary: DocumentSummary | null;
      readonly request: number;
      readonly type: "load-finished";
    }
  | {
      readonly message: string;
      readonly request: number;
      readonly type: "load-failed";
    };

export function initialDocumentSummaryLoad(
  known: DocumentSummary | null,
): DocumentSummaryLoadState {
  return known === null
    ? { request: 0, status: "loading" }
    : { documentSummary: known, status: "loaded" };
}

/**
 * Pure transition; returns the same reference for ignored events. Only the
 * newest load may finish or fail. A load that starts while the summary is
 * `missing` stays `missing` until it answers, so retrying does not flash a
 * loading state.
 *
 * | state \ event | known  | load-started        | load-finished (request) | load-failed (request) |
 * | ------------- | ------ | ------------------- | ----------------------- | --------------------- |
 * | loading       | loaded | loading             | loaded or missing       | failed                |
 * | loaded        | loaded | loading             | (same)                  | (same)                |
 * | missing       | loaded | missing, new request| loaded or missing       | failed                |
 * | failed        | loaded | loading             | (same)                  | (same)                |
 */
export function transitionDocumentSummaryLoad(
  state: DocumentSummaryLoadState,
  event: DocumentSummaryLoadEvent,
): DocumentSummaryLoadState {
  switch (event.type) {
    case "known":
      return state.status === "loaded" &&
        state.documentSummary === event.documentSummary
        ? state
        : { documentSummary: event.documentSummary, status: "loaded" };
    case "load-started":
      return state.status === "missing"
        ? { request: event.request, status: "missing" }
        : { request: event.request, status: "loading" };
    case "load-finished":
      if (!awaits(state, event.request)) return state;
      return event.documentSummary === null
        ? { request: event.request, status: "missing" }
        : { documentSummary: event.documentSummary, status: "loaded" };
    case "load-failed":
      return awaits(state, event.request)
        ? { message: event.message, request: event.request, status: "failed" }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** Whether the state is waiting on this exact load. */
function awaits(state: DocumentSummaryLoadState, request: number): boolean {
  return (
    (state.status === "loading" || state.status === "missing") &&
    state.request === request
  );
}
