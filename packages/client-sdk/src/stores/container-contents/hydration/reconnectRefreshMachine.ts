const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

export type ReconnectRefreshState =
  | { status: "idle" }
  | { status: "pending"; delayMs: number }
  | { status: "crawling" | "backoff"; delayMs: number; crawl: object };

type ReconnectRefreshEvent =
  | { type: "acknowledged" }
  | { type: "start"; crawl: object }
  | { type: "finish"; crawl: object; complete: boolean }
  | { type: "retry"; crawl: object };

/**
 * An acknowledgement supersedes any previous crawl, including its timer.
 * Pending starts once ready. A complete crawl goes idle, an incomplete one
 * waits, and its timer makes it pending again with a capped exponential delay.
 */
export function transitionReconnectRefresh(
  state: ReconnectRefreshState,
  event: ReconnectRefreshEvent,
): ReconnectRefreshState {
  switch (event.type) {
    case "acknowledged":
      return { status: "pending", delayMs: FIRST_RETRY_MS };
    case "start":
      return state.status === "pending"
        ? { status: "crawling", delayMs: state.delayMs, crawl: event.crawl }
        : state;
    case "finish":
      if (state.status !== "crawling" || state.crawl !== event.crawl)
        return state;
      return event.complete
        ? { status: "idle" }
        : { ...state, status: "backoff" };
    case "retry":
      return state.status === "backoff" && state.crawl === event.crawl
        ? {
            status: "pending",
            delayMs: Math.min(state.delayMs * 2, MAX_RETRY_MS),
          }
        : state;
    default:
      return event satisfies never;
  }
}
