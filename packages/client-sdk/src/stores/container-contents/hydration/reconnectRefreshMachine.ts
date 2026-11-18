const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

export type ReconnectRefreshState =
  | { status: "idle" | "deferred" }
  | { status: "pending"; delayMs: number }
  | { status: "crawling" | "backoff"; delayMs: number; crawl: object };

type ReconnectRefreshEvent =
  | { type: "acknowledged" }
  | { type: "runtimeChanged" }
  | { type: "start"; crawl: object }
  | {
      type: "finish";
      crawl: object;
      outcome: "complete" | "retry" | "refused";
    }
  | { type: "retry"; crawl: object };

function afterCrawl(
  state: { status: "crawling" | "backoff"; crawl: object; delayMs: number },
  outcome: "complete" | "retry" | "refused",
): ReconnectRefreshState {
  if (outcome === "complete") return { status: "idle" };
  // Leave a repeatedly refused proof for a fresh signal. A timed-out listing
  // or unavailable proof keeps retrying even on a quiet connection.
  if (outcome === "refused" && state.delayMs >= 4_000)
    return { status: "deferred" };
  return { ...state, status: "backoff" };
}

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
    case "runtimeChanged":
      if (state.status !== "deferred") return state;
      return { status: "pending", delayMs: FIRST_RETRY_MS };
    case "acknowledged":
      return { status: "pending", delayMs: FIRST_RETRY_MS };
    case "start":
      return state.status === "pending"
        ? { status: "crawling", delayMs: state.delayMs, crawl: event.crawl }
        : state;
    case "finish":
      if (state.status !== "crawling" || state.crawl !== event.crawl)
        return state;
      return afterCrawl(state, event.outcome);
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
