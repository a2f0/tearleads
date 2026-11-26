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
 * Which history a ready replay has on screen: this device's capture, or the
 * replay of the signed uploads shown in its place. The capture stays open
 * under a signed replay, as `local`, for the way back.
 */
type ShownDocumentHistorySource =
  | { readonly source: "local" }
  | { readonly local: DocumentHistory; readonly source: "signed" };

/**
 * A document's history replay, tagged with the open that started it.
 *
 * - `loading`: reading the document's durable history.
 * - `unavailable`: the document has no durable history to replay yet.
 * - `failed`: the history could not be read, or a stop could not be replayed.
 * - `ready`: `history` is on screen, from `source`. `selectedIndex` is the
 *   stop the user asked for; `shown` is the stop on screen, which lags it
 *   while a replay runs. `newerAvailable` means edits became durable after
 *   this device's capture was taken.
 */
export type DocumentHistoryState =
  | { readonly run: number; readonly status: "loading" }
  | { readonly run: number; readonly status: "unavailable" }
  | {
      readonly message: string;
      readonly run: number;
      readonly status: "failed";
    }
  | ({
      readonly history: DocumentHistory;
      readonly newerAvailable: boolean;
      readonly playing: boolean;
      readonly run: number;
      readonly selectedIndex: number;
      readonly shown: ShownDocumentHistoryStop | null;
      readonly status: "ready";
    } & ShownDocumentHistorySource);

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
      /** The history the stop was replayed from. */
      readonly history: DocumentHistory;
      readonly stop: ShownDocumentHistoryStop;
      readonly type: "shown";
    }
  | {
      /** The history whose stop could not be replayed. */
      readonly history: DocumentHistory;
      readonly message: string;
      readonly type: "replay-failed";
    }
  | { readonly run: number; readonly type: "newer-found" }
  /** Show the replay of the signed uploads in place of the capture. */
  | { readonly signed: DocumentHistory; readonly type: "signed-shown" }
  /** Go back to this device's capture. */
  | { readonly type: "local-shown" };

type ReadyState = Extract<DocumentHistoryState, { status: "ready" }>;

export const INITIAL_DOCUMENT_HISTORY: DocumentHistoryState = {
  run: 0,
  status: "loading",
};

function lastIndex(state: ReadyState): number {
  return state.history.stops.length - 1;
}

/**
 * Whether a stop is the document as it is now, so there is nothing to
 * restore: the newest stop of a capture that no later edit has overtaken.
 * Once newer edits exist, the capture's last stop is a past version too. No
 * stop of a signed replay qualifies: this device's copy differs from it.
 */
export function isCurrentDocumentVersion(
  state: ReadyState,
  index: number,
): boolean {
  return (
    state.source === "local" &&
    index === lastIndex(state) &&
    !state.newerAvailable
  );
}

/**
 * This device's capture, whichever history is on screen; null while none is
 * open. A different one is a different capture.
 */
export function localDocumentHistory(
  state: DocumentHistoryState,
): DocumentHistory | null {
  if (state.status !== "ready") return null;
  return state.source === "signed" ? state.local : state.history;
}

/** A history as it first appears: on its newest stop, not yet replayed. */
function onNewestStop(history: DocumentHistory) {
  return {
    history,
    playing: false,
    selectedIndex: history.stops.length - 1,
    shown: null,
  };
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
      return event.history === state.history &&
        event.stop.index === state.selectedIndex
        ? { ...state, shown: event.stop }
        : state;
    case "replay-failed":
      return event.history === state.history
        ? { message: event.message, run: state.run, status: "failed" }
        : state;
    case "newer-found":
      return event.run === state.run && !state.newerAvailable
        ? { ...state, newerAvailable: true }
        : state;
    case "signed-shown":
      // A signed replay with no stops has nothing to put on screen.
      return state.source === "local" && event.signed.stops.length > 0
        ? {
            ...onNewestStop(event.signed),
            local: state.history,
            newerAvailable: state.newerAvailable,
            run: state.run,
            source: "signed",
            status: "ready",
          }
        : state;
    case "local-shown":
      return state.source === "signed"
        ? {
            ...onNewestStop(state.local),
            newerAvailable: state.newerAvailable,
            run: state.run,
            source: "local",
            status: "ready",
          }
        : state;
    default:
      return state;
  }
}

/**
 * Pure transition; returns the same reference for ignored events so React
 * skips the re-render. Only the current run may finish an open or report
 * newer edits, and a stop is shown, or fails the replay, only when it was
 * replayed from the history on screen. The caller closes this device's
 * capture when the state it gets back no longer holds it. A signed replay is
 * never this machine's to close: whoever asked for it to be shown owns it,
 * and must take it off screen (`local-shown`, or a reopen) before closing it.
 *
 * | state \ event  | open-started | opened (run)         | open-failed (run) | seeked / stepped | play-toggled | tick      | shown (history) | replay-failed (history) | newer-found (run) | signed-shown   | local-shown    |
 * | -------------- | ------------ | -------------------- | ----------------- | ---------------- | ------------ | --------- | --------------- | ----------------------- | ----------------- | -------------- | -------------- |
 * | loading        | loading      | ready or unavailable | failed            | (same)           | (same)       | (same)    | (same)          | (same)                  | (same)            | (same)         | (same)         |
 * | unavailable    | loading      | (same)               | (same)            | (same)           | (same)       | (same)    | (same)          | (same)                  | (same)            | (same)         | (same)         |
 * | failed         | loading      | (same)               | (same)            | (same)           | (same)       | (same)    | (same)          | (same)                  | (same)            | (same)         | (same)         |
 * | ready (local)  | loading      | (same)               | (same)            | stop selected    | play / pause | next stop | stop on screen  | failed                  | newerAvailable    | ready (signed) | (same)         |
 * | ready (signed) | loading      | (same)               | (same)            | stop selected    | play / pause | next stop | stop on screen  | failed                  | newerAvailable    | (same)         | ready (local)  |
 *
 * Either way a source change opens the history on its newest stop, paused.
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
    // Open on the newest stop: the document as it is now.
    ...onNewestStop(event.history),
    newerAvailable: false,
    run: state.run,
    source: "local",
    status: "ready",
  };
}
