import type {
  ContainerDocumentQueries,
  DomainScope,
} from "@tearleads/client-sdk";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import {
  type DownloadHistoryEvent,
  type DownloadHistoryState,
  getDepartedDownloads,
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

function createDownloadHistoryStore(): DownloadHistoryStore {
  let state = INITIAL_DOWNLOAD_HISTORY;
  let loop = IDLE_DOWNLOAD_READ_LOOP;
  const listeners = new Set<() => void>();
  let queries: ContainerDocumentQueries | null = null;
  let nextRead = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function dispatch(event: DownloadHistoryEvent) {
    const next = transitionDownloadHistory(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function step(event: DownloadReadLoopEvent) {
    const previous = loop;
    loop = transitionDownloadReadLoop(loop, event);
    if (loop.status === previous.status) return;
    if (previous.status === "waiting") {
      clearTimeout(timer);
      timer = undefined;
    }
    if (loop.status === "waiting") {
      timer = setTimeout(
        () => step({ type: "delay-elapsed" }),
        DOWNLOAD_READ_COALESCE_MS,
      );
    } else if (loop.status === "reading" && queries) {
      void read(queries);
    }
  }

  async function read(source: ContainerDocumentQueries) {
    nextRead += 1;
    const request = nextRead;
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
      dispatch({ completed, pending, read: request, type: "read-finished" });
    } catch (error) {
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
    getSnapshot: () => state,
    requestRead(nextQueries, options) {
      queries = nextQueries;
      step({ immediate: options.immediate, type: "requested" });
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
