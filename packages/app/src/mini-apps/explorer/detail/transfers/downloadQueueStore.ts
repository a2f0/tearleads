import type {
  ContainerDocumentQueries,
  DomainScope,
} from "@tearleads/client-sdk";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import {
  type DownloadQueueEvent,
  type DownloadQueueState,
  getPendingDownloads,
  INITIAL_DOWNLOAD_QUEUE,
  transitionDownloadQueue,
} from "./downloadQueueMachine";
import {
  type DownloadReadLoopEvent,
  IDLE_DOWNLOAD_READ_LOOP,
  transitionDownloadReadLoop,
} from "./downloadReadLoopMachine";

// Coalesce discovery, document persistence, and sync notifications into one
// queue read after a short quiet period.
const DOWNLOAD_READ_COALESCE_MS = 300;

export interface DownloadQueueStore {
  getSnapshot: () => DownloadQueueState;
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
  left: DownloadQueueState,
  right: DownloadQueueState,
): boolean {
  return (
    left.status === right.status &&
    getPendingDownloads(left) === getPendingDownloads(right) &&
    (left.status === "failed" ? left.message : null) ===
      (right.status === "failed" ? right.message : null)
  );
}

function createDownloadQueueStore(): DownloadQueueStore {
  let state = INITIAL_DOWNLOAD_QUEUE;
  // What views read: the newest state that changed what they show, so a read
  // starting, which only retags the state, does not re-render them.
  let snapshot = state;
  let loop = IDLE_DOWNLOAD_READ_LOOP;
  const listeners = new Set<() => void>();
  let queries: ContainerDocumentQueries | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function dispatch(event: DownloadQueueEvent) {
    const next = transitionDownloadQueue(state, event);
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
      // Every view in this scope reads the same database, so a result is
      // kept whichever view's queries produced it.
      dispatch({ pending, read: request, type: "read-finished" });
    } catch (error) {
      // A failure from queries another request has since replaced (a
      // reopened database) is dropped; that request's own read follows.
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
      // Each view asks for an immediate read when it opens or its own
      // queries change; views share the store, so a different view's queries
      // alone are no reason to skip the coalescing delay.
      queries = nextQueries;
      step({ immediate: options.immediate, type: "requested" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // An unwatched queue keeps its rows but stops reading; the next
        // panel to open reads at once. Finished downloads do not depend on
        // it: the SDK records them whether or not a panel is open.
        if (listeners.size === 0) step({ type: "unwatched" });
      };
    },
  };
}

// The queue read lives as long as the domain scope, like the SDK's download
// history and sync coordinator it is shown beside.
const storesByScope = new WeakMap<DomainScope, DownloadQueueStore>();

export function getOrCreateDownloadQueueStore(
  domainScope: DomainScope,
): DownloadQueueStore {
  const existing = storesByScope.get(domainScope);
  if (existing) return existing;
  const created = createDownloadQueueStore();
  storesByScope.set(domainScope, created);
  return created;
}
