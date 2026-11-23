import { useEffect } from "react";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import { INITIAL_QUEUE_READ, type QueueReadState } from "./queueReadMachine";
import type { QueueReadStore } from "./queueReadStore";

/**
 * A queue-read store's state, kept current with `source` while this
 * component is mounted. A null source (the database is not ready) watches
 * nothing and shows as loading, so a closed database never shows the rows,
 * or the actions on them, from before it closed.
 */
export function useQueueRead<TSource, TItem>(
  store: QueueReadStore<TSource, TItem>,
  source: TSource | null,
): QueueReadState<TItem> {
  useEffect(
    () => (source === null ? undefined : store.watch(source)),
    [source, store],
  );
  const state = useTearleadsExternalStoreSnapshot(store);
  return source === null ? INITIAL_QUEUE_READ : state;
}
