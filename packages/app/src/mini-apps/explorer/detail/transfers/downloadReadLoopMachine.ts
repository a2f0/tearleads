/**
 * When the Downloads store reads the SDK queue: one read at a time, with
 * notifications that arrive mid-read coalesced into one follow-up.
 *
 * - `idle`: nothing scheduled.
 * - `waiting`: a read starts when the coalescing delay ends.
 * - `reading`: a read is in flight; `rerun` asks for one more after it.
 *
 * Effects run on entering a state: `waiting` arms the delay and `reading`
 * starts the read. Leaving `waiting` disarms the delay.
 */
export type DownloadReadLoopState =
  | { readonly status: "idle" }
  | { readonly status: "waiting" }
  | { readonly rerun: boolean; readonly status: "reading" };

export type DownloadReadLoopEvent =
  /** A change signal (`immediate: false`) or an opened view or Refresh. */
  | { readonly immediate: boolean; readonly type: "requested" }
  | { readonly type: "delay-elapsed" }
  | { readonly type: "read-settled"; readonly watched: boolean }
  /** The last view stopped watching, so pending follow-ups are dropped. */
  | { readonly type: "unwatched" };

export const IDLE_DOWNLOAD_READ_LOOP: DownloadReadLoopState = {
  status: "idle",
};

const READING: DownloadReadLoopState = { rerun: false, status: "reading" };
const WAITING: DownloadReadLoopState = { status: "waiting" };

/**
 * Pure transition; returns the same reference for ignored events.
 *
 * | state \ event   | requested (immediate) | requested (later) | delay-elapsed | read-settled          | unwatched |
 * | --------------- | --------------------- | ----------------- | ------------- | --------------------- | --------- |
 * | idle            | reading               | waiting           | (same)        | (same)                | (same)    |
 * | waiting         | reading               | (same)            | reading       | (same)                | idle      |
 * | reading         | reading, rerun        | reading, rerun    | (same)        | waiting or idle       | no rerun  |
 */
export function transitionDownloadReadLoop(
  state: DownloadReadLoopState,
  event: DownloadReadLoopEvent,
): DownloadReadLoopState {
  switch (event.type) {
    case "requested":
      return onRequested(state, event.immediate);
    case "delay-elapsed":
      return state.status === "waiting" ? READING : state;
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
  state: DownloadReadLoopState,
  immediate: boolean,
): DownloadReadLoopState {
  if (state.status === "reading")
    return state.rerun ? state : { rerun: true, status: "reading" };
  if (immediate) return READING;
  return state.status === "waiting" ? state : WAITING;
}

function onReadSettled(
  state: DownloadReadLoopState,
  watched: boolean,
): DownloadReadLoopState {
  if (state.status !== "reading") return state;
  return state.rerun && watched ? WAITING : IDLE_DOWNLOAD_READ_LOOP;
}

function onUnwatched(state: DownloadReadLoopState): DownloadReadLoopState {
  if (state.status === "waiting") return IDLE_DOWNLOAD_READ_LOOP;
  return state.status === "reading" && state.rerun ? READING : state;
}
