import type {
  ContainerDocumentQueries,
  DomainScope,
} from "@tearleads/client-sdk";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import {
  type DownloadHistoryEvent,
  type DownloadHistoryState,
  getDepartedDownloads,
  getDownloadHistoryEntries,
  INITIAL_DOWNLOAD_HISTORY,
  transitionDownloadHistory,
} from "./downloadHistoryMachine";
import {
  type DownloadReadLoopEvent,
  IDLE_DOWNLOAD_READ_LOOP,
  transitionDownloadReadLoop,
} from "./downloadReadLoopMachine";

// Coalesce discovery, document persistence, and sync notifications into one
// queue read after a short quiet period.
const DOWNLOAD_READ_COALESCE_MS = 300;

export interface DownloadHistoryStore {
  getSnapshot: () => DownloadHistoryState;
  /**
   * Read the queue with these queries: at once when `immediate`, otherwise
   * after the coalescing delay. A request made while a read is in flight runs
   * one more read after it.
   */
  requestRead: (
    queries: ContainerDocumentQueries,
    options: { immediate: boolean },
  ) => void;
  subscribe: (listener: () => void) => () => void;
}

// Whether two states show the same thing; they may differ only in read tag.
function looksTheSame(
  left: DownloadHistoryState,
  right: DownloadHistoryState,
): boolean {
  return (
    left.status === right.status &&
    getDownloadHistoryEntries(left) === getDownloadHistoryEntries(right) &&
    (left.status === "failed" ? left.message : null) ===
      (right.status === "failed" ? right.message : null)
  );
}

function createDownloadHistoryStore(): DownloadHistoryStore {
  let state = INITIAL_DOWNLOAD_HISTORY;
  // What views read: the newest state that changed what they show, so a read
  // starting, which only retags the state, does not re-render them.
  let snapshot = state;
  let loop = IDLE_DOWNLOAD_READ_LOOP;
  const listeners = new Set<() => void>();
  let queries: ContainerDocumentQueries | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function dispatch(event: DownloadHistoryEvent) {
    const next = transitionDownloadHistory(state, event);
    if (next === state) return;
    state = next;
    if (looksTheSame(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function step(event: DownloadReadLoopEvent) {
    const previous = loop;
    loop = transitionDownloadReadLoop(loop, event);
    if (previous.status === "waiting" && loop.status !== "waiting") {
      clearTimeout(timer);
      timer = undefined;
    }
    if (loop.status === "waiting" && previous.status !== "waiting") {
      timer = setTimeout(
        () => step({ type: "delay-elapsed" }),
        DOWNLOAD_READ_COALESCE_MS,
      );
    }
    if (loop.status === "reading" && loop.reads !== previous.reads && queries)
      void read(queries, loop.reads);
  }

  async function read(source: ContainerDocumentQueries, request: number) {
    dispatch({ read: request, type: "read-started" });
    try {
      const pending = await source.listPendingDownloads();
      // Only this store's loop settles the state and one read runs at a
      // time, so the rows departed now are the ones this read settles.
      const departed = getDepartedDownloads(state, pending);
      const completed =
        departed.length === 0
          ? []
          : await source.listCompletedDownloads(departed);
      // A result from replaced queries (a reopened database) is dropped; the
      // read the replacement asked for follows at once.
      if (source === queries)
        dispatch({ completed, pending, read: request, type: "read-finished" });
    } catch (error) {
      if (source === queries)
        dispatch({
          message: unknownErrorMessage(error),
          read: request,
          type: "read-failed",
        });
    } finally {
      step({ type: "read-settled", watched: listeners.size > 0 });
    }
  }

  return {
    getSnapshot: () => snapshot,
    requestRead(nextQueries, options) {
      // New queries always read at once: the rows on screen came from the
      // replaced ones.
      const immediate = options.immediate || nextQueries !== queries;
      queries = nextQueries;
      step({ immediate, type: "requested" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // An unwatched history keeps its rows but stops reading; the next
        // panel to open reads at once.
        if (listeners.size === 0) step({ type: "unwatched" });
      };
    },
  };
}

// The history lives exactly as long as the domain scope, which the SDK rotates
// with the database, signing identity, and sign-in, as the sync coordinator
// whose lanes the Sync Lanes view lists.
const storesByScope = new WeakMap<DomainScope, DownloadHistoryStore>();

export function getOrCreateDownloadHistoryStore(
  domainScope: DomainScope,
): DownloadHistoryStore {
  const existing = storesByScope.get(domainScope);
  if (existing) return existing;
  const created = createDownloadHistoryStore();
  storesByScope.set(domainScope, created);
  return created;
}
