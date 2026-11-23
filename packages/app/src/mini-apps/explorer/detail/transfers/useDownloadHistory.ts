import type {
  ContainerDocumentQueries,
  DomainScope,
  PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useDomainDownloadHistory } from "../../../../providers/sdk/useDomainDownloadHistory";
import {
  getQueueItems,
  type QueueReadState,
} from "../../../../stores/sync-queues/queueReadMachine";
import { getOrCreatePendingDownloadQueueStore } from "../../../../stores/sync-queues/syncQueueStores";
import { useQueueRead } from "../../../../stores/sync-queues/useQueueRead";
import {
  type DownloadHistoryEntry,
  mergeDownloadHistory,
} from "./downloadHistory";

/**
 * The Downloads rows for a scope: the SDK's durable queue, then the downloads
 * the SDK recorded finishing, which it records whether or not this panel is
 * open, as the sync coordinator records lane runs. The shared queue store
 * reads at once when the panel opens and then follows discovery, persistence,
 * sync, and completion signals itself; an unwatched queue does not poll
 * SQLite.
 */
export function useDownloadHistory(params: {
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
}): {
  entries: ReadonlyArray<DownloadHistoryEntry>;
  readNow: () => void;
  state: QueueReadState<PendingDownloadQueueItem>;
} {
  const store = getOrCreatePendingDownloadQueueStore(params.domainScope);
  const state = useQueueRead(store, params.documentQueries);
  const { completed } = useDomainDownloadHistory(params.domainScope);
  const pending = getQueueItems(state);
  // Finished downloads are known before the first queue read settles, so
  // they are listed while the queue still shows as loading.
  const entries = useMemo(
    () => mergeDownloadHistory(pending, completed),
    [completed, pending],
  );
  return { entries, readNow: store.readNow, state };
}
