import type { DocumentHistory, Documents } from "@tearleads/client-sdk";
import {
  type Dispatch,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import {
  type DocumentHistoryEvent,
  type DocumentHistoryState,
  INITIAL_DOCUMENT_HISTORY,
  localDocumentHistory,
  transitionDocumentHistory,
} from "./documentHistoryMachine";

/** Time each stop stays on screen during playback. */
const DOCUMENT_HISTORY_PLAY_STEP_MILLISECONDS = 250;

export interface DocumentHistoryControls {
  /** Reopen the history, picking up edits made since the capture. */
  readonly reload: () => void;
  readonly seek: (index: number) => void;
  /** Go back from a signed replay to this device's capture. */
  readonly showLocal: () => void;
  /**
   * Show a replay of the signed uploads in place of this device's capture,
   * which stays open underneath. The replay remains the caller's: it must
   * stay open while it is on screen, and History never closes it.
   */
  readonly showSigned: (signed: DocumentHistory) => void;
  readonly state: DocumentHistoryState;
  readonly step: (delta: -1 | 1) => void;
  readonly togglePlay: () => void;
}

type Send = Dispatch<DocumentHistoryEvent>;

interface HistorySource {
  /**
   * The ready database and domain scope the history is read from, or null
   * while there is none. A different one is a different history.
   */
  readonly database: object | null;
  readonly documents: Documents;
  readonly localId: string;
}

/** The newest operation each writer contributed to a capture. */
function capturedVersion(history: DocumentHistory): Map<string, number> {
  const version = new Map<string, number>();
  for (const stop of history.stops) {
    version.set(
      stop.peerId,
      Math.max(version.get(stop.peerId) ?? 0, stop.endCounter),
    );
  }
  return version;
}

/**
 * Whether a later capture holds operations this one does not. Stops alone do
 * not say: an edit that extends a writer's existing change adds no stop, and
 * that change need not be the newest one.
 */
function hasNewerOperations(current: DocumentHistory, later: DocumentHistory) {
  const currentVersion = capturedVersion(current);
  const laterVersion = capturedVersion(later);
  if (laterVersion.size !== currentVersion.size) return true;
  for (const [peerId, endCounter] of laterVersion) {
    if (currentVersion.get(peerId) !== endCounter) return true;
  }
  return false;
}

/**
 * Open a capture now and on every change of document, closing the one before
 * it. Returns the reopen action and a reader for the newest run, which is
 * bumped synchronously so work tagged with an older run can tell its capture
 * was closed before React re-renders.
 */
function useOpenDocumentHistory(
  { database, documents, localId }: HistorySource,
  send: Send,
): {
  readonly isCurrentRun: (run: number) => boolean;
  readonly open: () => void;
} {
  const currentRun = useRef(0);
  const closeCurrent = useRef<(() => void) | null>(null);

  const open = useCallback(() => {
    closeCurrent.current?.();
    currentRun.current += 1;
    const run = currentRun.current;
    let closed = false;
    let opened: DocumentHistory | null = null;
    closeCurrent.current = () => {
      closed = true;
      opened?.close();
    };
    send({ run, type: "open-started" });
    // Until the database is ready there is nothing to read; opening now would
    // report a document with history as having none. Stay loading instead.
    if (database === null) return;
    documents.openHistory(localId).then(
      (history) => {
        if (closed) {
          history?.close();
          return;
        }
        if (history !== null && history.stops.length === 0) {
          history.close();
        } else {
          opened = history;
        }
        send({ history: opened, run, type: "opened" });
      },
      (error: unknown) => {
        if (closed) return;
        send({ message: unknownErrorMessage(error), run, type: "open-failed" });
      },
    );
  }, [database, documents, localId, send]);

  useEffect(() => {
    open();
    return () => {
      closeCurrent.current?.();
      closeCurrent.current = null;
    };
  }, [open]);

  return {
    isCurrentRun: useCallback((run: number) => currentRun.current === run, []),
    open,
  };
}

/**
 * Replay the selected stop in its own task: a distant stop of a large
 * document takes long enough to drop frames if it ran while rendering.
 */
function useReplaySelectedStop(
  state: DocumentHistoryState,
  isCurrentRun: (run: number) => boolean,
  send: Send,
): void {
  const history = state.status === "ready" ? state.history : null;
  const selectedIndex = state.status === "ready" ? state.selectedIndex : -1;
  const shownIndex = state.status === "ready" ? (state.shown?.index ?? -1) : -1;
  const { run } = state;

  useEffect(() => {
    if (history === null || shownIndex === selectedIndex) return;
    const timer = setTimeout(() => {
      if (!isCurrentRun(run)) return;
      try {
        send({
          history,
          stop: {
            change: history.changeAt(selectedIndex),
            index: selectedIndex,
            view: history.viewAt(selectedIndex),
          },
          type: "shown",
        });
      } catch (error) {
        send({
          history,
          message: unknownErrorMessage(error),
          type: "replay-failed",
        });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [history, isCurrentRun, run, selectedIndex, send, shownIndex]);
}

function usePlayback(playing: boolean, send: Send): void {
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(
      () => send({ type: "tick" }),
      DOCUMENT_HISTORY_PLAY_STEP_MILLISECONDS,
    );
    return () => clearInterval(interval);
  }, [playing, send]);
}

/**
 * Notice edits the capture does not hold. A save of this document may add
 * stops, but opening the document also saves it, so compare a fresh capture
 * rather than trust the notification. It is this device's capture that is
 * compared, whichever history is on screen.
 */
function useNewerEditsCheck(
  { documents, localId }: HistorySource,
  state: DocumentHistoryState,
  send: Send,
): void {
  const history = localDocumentHistory(state);
  const newerAvailable = state.status === "ready" && state.newerAvailable;
  const { run } = state;

  useEffect(() => {
    if (history === null || newerAvailable) return;
    let stopped = false;
    let checking = false;
    let checkAgain = false;
    const check = () => {
      if (checking) {
        checkAgain = true;
        return;
      }
      checking = true;
      documents
        .openHistory(localId)
        .then((later) => {
          if (later === null) return;
          const newer = !stopped && hasNewerOperations(history, later);
          later.close();
          if (newer) send({ run, type: "newer-found" });
        })
        // A failed comparison leaves the capture as it is.
        .catch(() => undefined)
        .finally(() => {
          checking = false;
          if (checkAgain && !stopped) {
            checkAgain = false;
            check();
          }
        });
    };
    const unsubscribe = documents.subscribe((document) => {
      if (document.id === localId) check();
    });
    // A save that landed after the capture was read but before this
    // subscription began sent its notification to nobody: look once now.
    check();
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [documents, history, localId, newerAvailable, run, send]);
}

/**
 * A document with no durable history yet, such as a discovered shell, gains
 * one when it hydrates. Reopen when it is next saved.
 */
function useRetryWhenHistoryArrives(
  { documents, localId }: HistorySource,
  unavailable: boolean,
  open: () => void,
): void {
  useEffect(() => {
    if (!unavailable) return;
    let stopped = false;
    // Look before reopening: a save that brings no history would only flash
    // the view back to loading.
    const probe = () => {
      documents
        .openHistory(localId)
        .then((history) => {
          const arrived = history !== null && history.stops.length > 0;
          history?.close();
          if (arrived && !stopped) open();
        })
        .catch(() => undefined);
    };
    const unsubscribe = documents.subscribe((document) => {
      if (document.id === localId) probe();
    });
    // The history may have arrived between the open that found none and
    // this subscription: look once now.
    probe();
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [documents, localId, open, unavailable]);
}

/**
 * Replay one document's history. Opens a capture of its durable history,
 * replays the selected stop outside rendering, plays stops on a timer, and
 * notices when the document gains edits the capture does not hold. The capture
 * is closed when the document changes or the caller unmounts.
 */
export function useDocumentHistory(localId: string): DocumentHistoryControls {
  const { documents } = useTearleads();
  const { infra, state: runtimeState } = useTearleadsRuntime();
  const [state, send] = useReducer(
    transitionDocumentHistory,
    INITIAL_DOCUMENT_HISTORY,
  );
  // One object per database and domain scope: a new signing identity can
  // keep the same database handle and documents service, yet its saves are
  // announced under a new scope, so everything below must start over.
  const { domainScope } = runtimeState;
  const { dbStatus, execSql } = infra;
  const database = useMemo(
    () => (dbStatus === "ready" ? { domainScope, execSql } : null),
    [dbStatus, domainScope, execSql],
  );
  const source: HistorySource = { database, documents, localId };
  const { isCurrentRun, open } = useOpenDocumentHistory(source, send);
  useReplaySelectedStop(state, isCurrentRun, send);
  usePlayback(state.status === "ready" && state.playing, send);
  useNewerEditsCheck(source, state, send);
  useRetryWhenHistoryArrives(source, state.status === "unavailable", open);

  return {
    reload: open,
    seek: useCallback((index: number) => send({ index, type: "seeked" }), []),
    showLocal: useCallback(() => send({ type: "local-shown" }), []),
    showSigned: useCallback(
      (signed: DocumentHistory) => send({ signed, type: "signed-shown" }),
      [],
    ),
    state,
    step: useCallback((delta: -1 | 1) => send({ delta, type: "stepped" }), []),
    togglePlay: useCallback(() => send({ type: "play-toggled" }), []),
  };
}
