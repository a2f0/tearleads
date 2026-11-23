/**
 * One of the SDK's durable queues (writes or downloads) as a queue-read store
 * last read it in one domain scope, tagged with the newest read so only that
 * read may settle it.
 *
 * - `loading`: the queue has not been read in this scope yet.
 * - `ready`: the newest settled read succeeded.
 * - `failed`: the newest settled read threw; `items` keeps the last rows.
 */
export type QueueReadState<TItem> =
  | { readonly read: number; readonly status: "loading" }
  | {
      readonly items: ReadonlyArray<TItem>;
      readonly read: number;
      readonly status: "ready";
    }
  | {
      readonly items: ReadonlyArray<TItem>;
      readonly message: string;
      readonly read: number;
      readonly status: "failed";
    };

export type QueueReadEvent<TItem> =
  | { readonly read: number; readonly type: "read-started" }
  | {
      readonly items: ReadonlyArray<TItem>;
      readonly read: number;
      readonly type: "read-finished";
    }
  | {
      readonly message: string;
      readonly read: number;
      readonly type: "read-failed";
    };

export const INITIAL_QUEUE_READ: QueueReadState<never> = {
  read: 0,
  status: "loading",
};

const NO_ITEMS: ReadonlyArray<never> = [];

/** The rows the newest settled read left, or none before the first. */
export function getQueueItems<TItem>(
  state: QueueReadState<TItem>,
): ReadonlyArray<TItem> {
  return state.status === "loading" ? NO_ITEMS : state.items;
}

/**
 * Pure transition; returns the same reference for ignored events. A read
 * starting does not change what a view shows. Only the newest read may
 * settle the state.
 *
 * | state \ event | read-started   | read-finished (newest) | read-failed (newest) |
 * | ------------- | -------------- | ---------------------- | -------------------- |
 * | loading       | loading (read) | ready                  | failed, no rows      |
 * | ready         | ready (read)   | ready                  | failed, same rows    |
 * | failed        | failed (read)  | ready                  | failed, same rows    |
 */
export function transitionQueueRead<TItem>(
  state: QueueReadState<TItem>,
  event: QueueReadEvent<TItem>,
): QueueReadState<TItem> {
  switch (event.type) {
    case "read-started":
      return event.read > state.read ? { ...state, read: event.read } : state;
    case "read-finished":
      return event.read === state.read
        ? { items: event.items, read: event.read, status: "ready" }
        : state;
    case "read-failed":
      return event.read === state.read
        ? {
            items: getQueueItems(state),
            message: event.message,
            read: event.read,
            status: "failed",
          }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
