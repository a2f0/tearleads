/**
 * When a queue-read store reads its SDK queue: one read at a time, with
 * requests that arrive mid-read coalesced into one follow-up.
 *
 * - `idle`: nothing scheduled.
 * - `waiting`: a read starts when the coalescing delay ends.
 * - `reading`: a read is in flight; `rerun` says whether one follows it at
 *   once (`now`, for an opened view or Refresh), after the delay (`soon`, for
 *   a change signal), or not at all.
 *
 * Every state counts the reads started so far. Effects run on entering a
 * state: `waiting` arms the delay, and a higher count in `reading` starts that
 * read, even straight after the previous one. Leaving `waiting` disarms the
 * delay.
 */
export type QueueReadLoopState =
  | { readonly reads: number; readonly status: "idle" }
  | { readonly reads: number; readonly status: "waiting" }
  | {
      readonly reads: number;
      readonly rerun: "none" | "soon" | "now";
      readonly status: "reading";
    };

export type QueueReadLoopEvent =
  /** A change signal (`immediate: false`) or an opened view or Refresh. */
  | { readonly immediate: boolean; readonly type: "requested" }
  | { readonly type: "delay-elapsed" }
  | { readonly type: "read-settled"; readonly watched: boolean }
  /** The last view stopped watching, so pending follow-ups are dropped. */
  | { readonly type: "unwatched" };

export const IDLE_QUEUE_READ_LOOP: QueueReadLoopState = {
  reads: 0,
  status: "idle",
};

function startRead(state: QueueReadLoopState): QueueReadLoopState {
  return { reads: state.reads + 1, rerun: "none", status: "reading" };
}

/**
 * Pure transition; returns the same reference for ignored events.
 *
 * | state \ event | requested (immediate) | requested (later) | delay-elapsed | read-settled (watched)       | unwatched  |
 * | ------------- | --------------------- | ----------------- | ------------- | ---------------------------- | ---------- |
 * | idle          | next read             | waiting           | (same)        | (same)                       | (same)     |
 * | waiting       | next read             | (same)            | next read     | (same)                       | idle       |
 * | reading       | rerun now             | rerun soon        | (same)        | next read, waiting, or idle  | rerun none |
 */
export function transitionQueueReadLoop(
  state: QueueReadLoopState,
  event: QueueReadLoopEvent,
): QueueReadLoopState {
  switch (event.type) {
    case "requested":
      return onRequested(state, event.immediate);
    case "delay-elapsed":
      return state.status === "waiting" ? startRead(state) : state;
    case "read-settled":
      return onReadSettled(state, event.watched);
    case "unwatched":
      return onUnwatched(state);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function onRequested(
  state: QueueReadLoopState,
  immediate: boolean,
): QueueReadLoopState {
  if (state.status === "reading") {
    const rerun = immediate || state.rerun === "now" ? "now" : "soon";
    return rerun === state.rerun ? state : { ...state, rerun };
  }
  if (immediate) return startRead(state);
  return state.status === "waiting"
    ? state
    : { reads: state.reads, status: "waiting" };
}

function onReadSettled(
  state: QueueReadLoopState,
  watched: boolean,
): QueueReadLoopState {
  if (state.status !== "reading") return state;
  if (!watched || state.rerun === "none")
    return { reads: state.reads, status: "idle" };
  return state.rerun === "now"
    ? startRead(state)
    : { reads: state.reads, status: "waiting" };
}

function onUnwatched(state: QueueReadLoopState): QueueReadLoopState {
  if (state.status === "waiting") return { reads: state.reads, status: "idle" };
  return state.status === "reading" && state.rerun !== "none"
    ? { ...state, rerun: "none" }
    : state;
}
