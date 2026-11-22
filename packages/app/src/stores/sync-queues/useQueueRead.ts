import { useEffect } from "react";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import type { QueueReadState } from "./queueReadMachine";
import type { QueueReadStore } from "./queueReadStore";

/**
 * A queue-read store's state, kept current with `source` while this
 * component is mounted. A null source (the database is not ready) watches
 * nothing and leaves the last state in place for the caller to mask.
 */
export function useQueueRead<TSource, TItem>(
  store: QueueReadStore<TSource, TItem>,
  source: TSource | null,
): QueueReadState<TItem> {
  useEffect(
    () => (source === null ? undefined : store.watch(source)),
    [source, store],
  );
  return useTearleadsExternalStoreSnapshot(store);
}
