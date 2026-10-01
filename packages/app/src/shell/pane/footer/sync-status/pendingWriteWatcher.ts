import type { PendingWriteQueueItem } from "@tearleads/client-sdk";

interface PendingWriteWatcherDeps {
  /** Read the durable write queue for the active domain. */
  readonly listPendingWrites: () => Promise<
    ReadonlyArray<PendingWriteQueueItem>
  >;
  /** Subscribe to every signal that can change the queue; returns an unsubscribe. */
  readonly subscribe: (onChange: () => void) => () => void;
  /**
   * Report a freshly read queue; not called on a failed read. Callers project
   * it as they need (a count for the footer indicator, the items themselves for
   * the System Monitor report), so the watcher stays a generic read machine.
   */
  readonly onSnapshot: (items: ReadonlyArray<PendingWriteQueueItem>) => void;
  /**
   * Report a failed read. A read that keeps failing (e.g. an obsolete local
   * schema) would otherwise leave a caller that waits for its first snapshot
   * stuck in its loading state forever with nothing to show for it.
   */
  readonly onError: (error: unknown) => void;
  /** Trailing-throttle window (ms) collapsing a burst of changes into one scan. */
  readonly throttleMs: number;
}

interface PendingWriteWatcher {
  readonly stop: () => void;
}

/**
 * The footer indicator's queue-reading state machine, factored out of React and
 * off the SDK so its race handling is unit-testable. It reads once immediately,
 * then re-reads on any subscribed change — throttled so a burst collapses into a
 * single scan, serialized so reads never overlap (a change mid-read queues
 * exactly one follow-up), and guarded so nothing is reported after `stop()`. A
 * failed read reports its error rather than a snapshot, so the caller keeps its
 * last known value and can surface the failure.
 */
export function createPendingWriteWatcher(
  deps: PendingWriteWatcherDeps,
): PendingWriteWatcher {
  const { listPendingWrites, subscribe, onSnapshot, onError, throttleMs } =
    deps;
  let active = true;
  let reading = false;
  let rereadPending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    // Trailing throttle: the first change arms the timer; further changes within
    // the window are absorbed, firing one scan when it elapses. Also moves the
    // scan off the notifying call stack, so a snapshot published during another
    // component's render never drives a React update mid-render.
    if (timer !== null) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (active) {
        read();
      }
    }, throttleMs);
  };

  const read = () => {
    // Serialize: a change during an in-flight scan queues exactly one throttled
    // follow-up rather than launching an overlapping scan.
    if (reading) {
      rereadPending = true;
      return;
    }
    reading = true;
    listPendingWrites()
      .then(
        (items) => {
          if (active) {
            onSnapshot(items);
          }
        },
        (error: unknown) => {
          if (active) {
            onError(error);
          }
        },
      )
      .finally(() => {
        reading = false;
        if (active && rereadPending) {
          rereadPending = false;
          schedule();
        }
      });
  };

  read();
  const unsubscribe = subscribe(schedule);

  return {
    stop: () => {
      active = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribe();
    },
  };
}
