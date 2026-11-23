import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import {
  IDLE_QUEUE_READ_LOOP,
  type QueueReadLoopEvent,
  transitionQueueReadLoop,
} from "./queueReadLoopMachine";
import {
  getQueueItems,
  INITIAL_QUEUE_READ,
  type QueueReadEvent,
  type QueueReadState,
  transitionQueueRead,
} from "./queueReadMachine";

/**
 * One durable SDK queue, read for every view of one domain scope: the Sync
 * Status tray app, the System Monitor report, and the Explorer panels share
 * one store, so a burst of sync activity costs one read per coalescing window
 * however many of them are open.
 */
export interface QueueReadStore<TSource, TItem> {
  getSnapshot: () => QueueReadState<TItem>;
  /** Re-read at once, for Refresh; ignored while nothing watches. */
  readNow: () => void;
  subscribe: (listener: () => void) => () => void;
  /**
   * Keep the queue current, reading it with `source`, until the returned
   * function is called. The first watch, and a watch with a source other than
   * the one being read, reads at once; the newest watch's source is read.
   * While anything watches, the store follows its change signals itself.
   */
  watch: (source: TSource) => () => void;
}

export interface QueueReadStoreOptions<TSource, TItem> {
  /** The quiet period a change signal waits for, so a burst reads once. */
  readonly coalesceMs: number;
  readonly read: (source: TSource) => Promise<ReadonlyArray<TItem>>;
  /** Subscribe to every signal that can change the queue. */
  readonly subscribeToChanges: (onChange: () => void) => () => void;
}

// Whether two states show the same thing; they may differ only in read tag.
function looksTheSame<TItem>(
  left: QueueReadState<TItem>,
  right: QueueReadState<TItem>,
): boolean {
  return (
    left.status === right.status &&
    getQueueItems(left) === getQueueItems(right) &&
    (left.status === "failed" ? left.message : null) ===
      (right.status === "failed" ? right.message : null)
  );
}

export function createQueueReadStore<TSource, TItem>(
  options: QueueReadStoreOptions<TSource, TItem>,
): QueueReadStore<TSource, TItem> {
  let state: QueueReadState<TItem> = INITIAL_QUEUE_READ;
  // What views read: the newest state that changed what they show, so a read
  // starting, which only retags the state, does not re-render them.
  let snapshot = state;
  let loop = IDLE_QUEUE_READ_LOOP;
  const listeners = new Set<() => void>();
  // Open watches, oldest first; the newest one's source is read.
  const watches: Array<{ readonly source: TSource }> = [];
  let stopFollowingChanges: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function currentSource(): TSource | undefined {
    return watches.at(-1)?.source;
  }

  function dispatch(event: QueueReadEvent<TItem>) {
    const next = transitionQueueRead(state, event);
    if (next === state) return;
    state = next;
    if (looksTheSame(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function step(event: QueueReadLoopEvent) {
    const previous = loop;
    loop = transitionQueueReadLoop(loop, event);
    if (previous.status === "waiting" && loop.status !== "waiting") {
      clearTimeout(timer);
      timer = undefined;
    }
    if (loop.status === "waiting" && previous.status !== "waiting") {
      timer = setTimeout(
        () => step({ type: "delay-elapsed" }),
        options.coalesceMs,
      );
    }
    const source = currentSource();
    // Requests are only made while watched, so a started read has a source.
    if (
      loop.status === "reading" &&
      loop.reads !== previous.reads &&
      source !== undefined
    )
      void read(source, loop.reads);
  }

  async function read(source: TSource, request: number) {
    dispatch({ read: request, type: "read-started" });
    try {
      const items = await options.read(source);
      // Every watch in this scope reads the same database, so a result is
      // kept whichever watch's source produced it.
      dispatch({ items, read: request, type: "read-finished" });
    } catch (error) {
      if (source === currentSource())
        dispatch({
          message: unknownErrorMessage(error),
          read: request,
          type: "read-failed",
        });
      // A failure from a source no longer read (a reopened database, or a
      // closed view's handle) is dropped, and the current source reads next,
      // so the views still watching never wait on a failure they cannot see.
      else if (watches.length > 0) step({ immediate: true, type: "requested" });
    } finally {
      step({ type: "read-settled", watched: watches.length > 0 });
    }
  }

  function onChange() {
    if (watches.length > 0) step({ immediate: false, type: "requested" });
  }

  return {
    getSnapshot: () => snapshot,
    readNow() {
      if (watches.length > 0) step({ immediate: true, type: "requested" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch(source) {
      const entry = { source };
      const previousSource = currentSource();
      watches.push(entry);
      stopFollowingChanges ??= options.subscribeToChanges(onChange);
      // An unwatched store may be stale, and a new source may be a reopened
      // database, so either reads at once.
      if (previousSource !== source)
        step({ immediate: true, type: "requested" });
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        watches.splice(watches.indexOf(entry), 1);
        if (watches.length > 0) return;
        // An unwatched queue keeps its rows but stops reading; the next watch
        // reads at once.
        stopFollowingChanges?.();
        stopFollowingChanges = null;
        step({ type: "unwatched" });
      };
    },
  };
}
