import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";

export interface RowWritersRequest {
  readonly documentId: string;
}

type CompactSegments = DocumentEditAttributionResponse["segments"];

/**
 * One attribution read for one request scope. `Segments` is what the read
 * yields: the compact intervals by default, or the per-upload ranges.
 */
export type RowWritersState<Segments = CompactSegments> =
  | { status: "idle" }
  | { status: "loading"; request: RowWritersRequest }
  | { status: "unavailable"; request: RowWritersRequest }
  | {
      status: "ready";
      request: RowWritersRequest;
      segments: Segments;
    };

export type RowWritersEvent<Segments = CompactSegments> =
  | { type: "request"; request: RowWritersRequest | null }
  | { type: "failed"; request: RowWritersRequest }
  | {
      type: "loaded";
      request: RowWritersRequest;
      segments: Segments;
    };

// Request identity, not just document id, rejects old completions after a
// refresh or an A -> B -> A scope switch. Completion outside loading is ignored.
export function transitionRowWriters<Segments = CompactSegments>(
  state: RowWritersState<Segments>,
  event: RowWritersEvent<Segments>,
): RowWritersState<Segments> {
  switch (event.type) {
    case "request":
      return event.request
        ? { status: "loading", request: event.request }
        : { status: "idle" };
    case "failed":
    case "loaded":
      if (state.status !== "loading" || state.request !== event.request) {
        return state;
      }
      return event.type === "failed"
        ? { status: "unavailable", request: event.request }
        : { status: "ready", request: event.request, segments: event.segments };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
