/** One attribution read's request: a document, and the scope it is read in. */
export interface AttributionReadRequest {
  readonly documentId: string;
  /**
   * The document and session the read belongs to. It outlives the refresh
   * after each sync, so a refresh of what is held can be told from a read for
   * another document or session.
   */
  readonly scope: object;
}

/**
 * One attribution read for one request. `Result` is what the read yields: the
 * compact intervals, or the per-upload ranges. While a refresh loads, and
 * after it fails, `previous` is the last result read in the same scope, or
 * null when there is none: another document or session never carries it.
 */
export type AttributionReadState<Result> =
  | { status: "idle" }
  | {
      status: "loading";
      request: AttributionReadRequest;
      previous: Result | null;
    }
  | {
      status: "unavailable";
      request: AttributionReadRequest;
      previous: Result | null;
    }
  | { status: "ready"; request: AttributionReadRequest; result: Result };

export type AttributionReadEvent<Result> =
  | { type: "request"; request: AttributionReadRequest | null }
  | { type: "failed"; request: AttributionReadRequest }
  | { type: "loaded"; request: AttributionReadRequest; result: Result };

/** The latest result `state` holds for `scope`, if any. */
function latestResultInScope<Result>(
  state: AttributionReadState<Result>,
  scope: object,
): Result | null {
  switch (state.status) {
    case "idle":
      return null;
    case "ready":
      return state.request.scope === scope ? state.result : null;
    default:
      return state.request.scope === scope ? state.previous : null;
  }
}

// Request identity, not just document id, rejects old completions after a
// refresh or an A -> B -> A scope switch. Completion outside loading is
// ignored. A request in the same scope keeps the latest result as `previous`;
// one in another scope, or no request, drops it.
export function transitionAttributionRead<Result>(
  state: AttributionReadState<Result>,
  event: AttributionReadEvent<Result>,
): AttributionReadState<Result> {
  switch (event.type) {
    case "request":
      return event.request
        ? {
            status: "loading",
            request: event.request,
            previous: latestResultInScope(state, event.request.scope),
          }
        : { status: "idle" };
    case "failed":
    case "loaded":
      if (state.status !== "loading" || state.request !== event.request) {
        return state;
      }
      return event.type === "failed"
        ? {
            status: "unavailable",
            request: event.request,
            previous: state.previous,
          }
        : { status: "ready", request: event.request, result: event.result };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * What `request`'s own read yielded: its result once ready, else null.
 * Effects request after commit, so this already hides an old request's result
 * in the first render of a new one.
 */
export function currentAttributionResult<Result>(
  state: AttributionReadState<Result>,
  request: AttributionReadRequest | null,
): Result | null {
  return state.status === "ready" && state.request === request
    ? state.result
    : null;
}

/**
 * The latest result read in `request`'s scope: its own once ready, and until
 * then (while a refresh loads, after it fails, and in the render before it is
 * requested) the one it refreshes. Never another document's or session's.
 */
export function heldAttributionResult<Result>(
  state: AttributionReadState<Result>,
  request: AttributionReadRequest | null,
): Result | null {
  return request === null ? null : latestResultInScope(state, request.scope);
}
