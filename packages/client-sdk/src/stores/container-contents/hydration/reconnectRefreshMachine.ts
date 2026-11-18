import type { HydrationOutcome } from "../../../workflows/container-contents/remoteHydration";

interface RetryProgress {
  delayMs: number;
  refusals: number;
}
const FIRST_ATTEMPT = {
  status: "pending",
  delayMs: 1_000,
  refusals: 0,
} as const;
const MAX_RETRY_MS = 60_000;
const PROOF_REFUSAL_LIMIT = 3;

type ActiveCrawl = RetryProgress & {
  status: "crawling" | "backoff";
  crawl: object;
};
export type ReconnectRefreshState =
  | { status: "idle" | "deferred" | "disposed" }
  | (RetryProgress & { status: "pending" })
  | ActiveCrawl;

export type ReconnectOutcome = HydrationOutcome | "unexpectedFailure";

type ReconnectRefreshEvent =
  | { type: "acknowledged" | "runtimeChanged" | "disposed" }
  | { type: "start"; crawl: object }
  | { type: "finish"; crawl: object; outcome: ReconnectOutcome }
  | { type: "retry"; crawl: object };

function afterCrawl(
  state: ActiveCrawl,
  outcome: ReconnectOutcome,
): ReconnectRefreshState {
  if (outcome === "complete") return { status: "idle" };
  if (outcome === "unexpectedFailure") return { status: "deferred" };
  const refusals = outcome === "refused" ? state.refusals + 1 : 0;
  if (refusals >= PROOF_REFUSAL_LIMIT) return { status: "deferred" };
  return { ...state, status: "backoff", refusals };
}

/** Only the current crawl or its own timer can consume outstanding work. */
export function transitionReconnectRefresh(
  state: ReconnectRefreshState,
  event: ReconnectRefreshEvent,
): ReconnectRefreshState {
  if (state.status === "disposed") return state;
  switch (event.type) {
    case "disposed":
      return { status: "disposed" };
    case "runtimeChanged":
      return state.status === "idle" ? state : FIRST_ATTEMPT;
    case "acknowledged":
      return FIRST_ATTEMPT;
    case "start":
      return state.status === "pending"
        ? { ...state, status: "crawling", crawl: event.crawl }
        : state;
    case "finish":
      return state.status === "crawling" && state.crawl === event.crawl
        ? afterCrawl(state, event.outcome)
        : state;
    case "retry":
      return state.status === "backoff" && state.crawl === event.crawl
        ? {
            status: "pending",
            delayMs: Math.min(state.delayMs * 2, MAX_RETRY_MS),
            refusals: state.refusals,
          }
        : state;
    default:
      return event satisfies never;
  }
}
