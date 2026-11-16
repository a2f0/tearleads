import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryView,
} from "@tearleads/client-sdk";

/** One replayed stop: the document as it was, and what that stop changed. */
export interface ShownDocumentHistoryStop {
  readonly change: DocumentHistoryChange;
  readonly index: number;
  readonly view: DocumentHistoryView;
}

/**
 * A document's history replay, tagged with the open that started it.
 *
 * - `loading`: reading the document's durable history.
 * - `unavailable`: the document has no durable history to replay yet.
 * - `failed`: the history could not be read, or a stop could not be replayed.
 * - `ready`: `history` is open. `selectedIndex` is the stop the user asked
 *   for; `shown` is the stop on screen, which lags it while a replay runs.
 *   `newerAvailable` means edits became durable after this capture was taken.
 */
export type DocumentHistoryState =
  | { readonly run: number; readonly status: "loading" }
  | { readonly run: number; readonly status: "unavailable" }
  | {
      readonly message: string;
      readonly run: number;
      readonly status: "failed";
    }
  | {
      readonly history: DocumentHistory;
      readonly newerAvailable: boolean;
      readonly playing: boolean;
      readonly run: number;
      readonly selectedIndex: number;
      readonly shown: ShownDocumentHistoryStop | null;
      readonly status: "ready";
    };

export type DocumentHistoryEvent =
  | { readonly run: number; readonly type: "open-started" }
  | {
      readonly history: DocumentHistory | null;
      readonly run: number;
      readonly type: "opened";
    }
  | {
      readonly message: string;
      readonly run: number;
      readonly type: "open-failed";
    }
  | { readonly index: number; readonly type: "seeked" }
  | { readonly delta: -1 | 1; readonly type: "stepped" }
  | { readonly type: "play-toggled" }
  | { readonly type: "tick" }
  | {
      readonly run: number;
      readonly stop: ShownDocumentHistoryStop;
      readonly type: "shown";
    }
  | {
      readonly message: string;
      readonly run: number;
      readonly type: "replay-failed";
    }
  | { readonly run: number; readonly type: "newer-found" };

type ReadyState = Extract<DocumentHistoryState, { status: "ready" }>;

export const INITIAL_DOCUMENT_HISTORY: DocumentHistoryState = {
  run: 0,
  status: "loading",
};

function lastIndex(state: ReadyState): number {
  return state.history.stops.length - 1;
}

function clampIndex(state: ReadyState, index: number): number {
  if (!Number.isFinite(index)) return state.selectedIndex;
  return Math.min(lastIndex(state), Math.max(0, Math.round(index)));
}

/** Move to a stop the user chose. Choosing a stop always stops playback. */
function select(state: ReadyState, index: number): ReadyState {
  const selectedIndex = clampIndex(state, index);
  return selectedIndex === state.selectedIndex && !state.playing
    ? state
    : { ...state, playing: false, selectedIndex };
}

function togglePlay(state: ReadyState): ReadyState {
  if (state.playing) return { ...state, playing: false };
  const last = lastIndex(state);
  if (last === 0) return state;
  // Playing from the newest stop starts over from the oldest.
  return {
    ...state,
    playing: true,
    selectedIndex: state.selectedIndex === last ? 0 : state.selectedIndex,
  };
}

function tick(state: ReadyState): ReadyState {
  // Wait for the stop on screen to catch up before advancing again.
  if (!state.playing || state.shown?.index !== state.selectedIndex) {
    return state;
  }
  const selectedIndex = state.selectedIndex + 1;
  const last = lastIndex(state);
  return selectedIndex >= last
    ? { ...state, playing: false, selectedIndex: last }
    : { ...state, selectedIndex };
}

function transitionReady(
  state: ReadyState,
  event: DocumentHistoryEvent,
): DocumentHistoryState {
  switch (event.type) {
    case "seeked":
      return select(state, event.index);
    case "stepped":
      return select(state, state.selectedIndex + event.delta);
    case "play-toggled":
      return togglePlay(state);
    case "tick":
      return tick(state);
    case "shown":
      return event.run === state.run && event.stop.index === state.selectedIndex
        ? { ...state, shown: event.stop }
        : state;
    case "replay-failed":
      return event.run === state.run
        ? { message: event.message, run: state.run, status: "failed" }
        : state;
    case "newer-found":
      return event.run === state.run && !state.newerAvailable
        ? { ...state, newerAvailable: true }
        : state;
    default:
      return state;
  }
}

/**
 * Pure transition; returns the same reference for ignored events so React
 * skips the re-render. Only the current run may finish an open, show a stop,
 * or report newer edits. The caller closes any `history` the state it gets
 * back does not hold.
 *
 * | state \ event | open-started | opened (run)          | open-failed (run) | seeked / stepped | play-toggled | tick            | shown (run)   | replay-failed (run) | newer-found (run) |
 * | ------------- | ------------ | --------------------- | ----------------- | ---------------- | ------------ | --------------- | ------------- | ------------------- | ----------------- |
 * | loading       | loading      | ready or unavailable  | failed            | (same)           | (same)       | (same)          | (same)        | (same)              | (same)            |
 * | unavailable   | loading      | (same)                | (same)            | (same)           | (same)       | (same)          | (same)        | (same)              | (same)            |
 * | failed        | loading      | (same)                | (same)            | (same)           | (same)       | (same)          | (same)        | (same)              | (same)            |
 * | ready         | loading      | (same)                | (same)            | stop selected    | play / pause | next stop       | stop on screen| failed              | newerAvailable    |
 */
export function transitionDocumentHistory(
  state: DocumentHistoryState,
  event: DocumentHistoryEvent,
): DocumentHistoryState {
  if (event.type === "open-started") {
    return { run: event.run, status: "loading" };
  }
  if (state.status === "ready") {
    return transitionReady(state, event);
  }
  if (state.status !== "loading" || !("run" in event)) {
    return state;
  }
  if (event.run !== state.run) {
    return state;
  }
  if (event.type === "open-failed") {
    return { message: event.message, run: state.run, status: "failed" };
  }
  if (event.type !== "opened") {
    return state;
  }
  if (event.history === null || event.history.stops.length === 0) {
    return { run: state.run, status: "unavailable" };
  }
  return {
    history: event.history,
    newerAvailable: false,
    playing: false,
    run: state.run,
    // Open on the newest stop: the document as it is now.
    selectedIndex: event.history.stops.length - 1,
    shown: null,
    status: "ready",
  };
}
