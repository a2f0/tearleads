import {
  type ContainerDocumentQueries,
  type DomainScope,
  type PendingDownloadQueueItem,
  type PendingWriteQueueItem,
  subscribeToDomainDownloadHistory,
  subscribeToDomainSyncCoordinator,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk";
import { createQueueReadStore, type QueueReadStore } from "./queueReadStore";

export type PendingWriteQueueStore = QueueReadStore<
  ContainerDocumentQueries,
  PendingWriteQueueItem
>;

export type PendingDownloadQueueStore = QueueReadStore<
  ContainerDocumentQueries,
  PendingDownloadQueueItem
>;

// `listPendingWrites()` is an identity-wide scan (multiple tables plus
// deferred Loro tails), and the always-mounted Sync Status tray app keeps it
// watched, so a burst of changes reads at most once per window.
const WRITE_QUEUE_COALESCE_MS = 750;

// Downloads is read only while something shows it, so it can follow faster.
const DOWNLOAD_QUEUE_COALESCE_MS = 300;

function subscribeToAll(
  subscriptions: ReadonlyArray<() => () => void>,
): () => void {
  const unsubscribes = subscriptions.map((subscribe) => subscribe());
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

// Both queues change when a lane is requested, runs, or settles, and when a
// document persists: a deferred write (e.g. `deferRemoteSync` during system
// bootstrap) enqueues durable work without requesting a lane, so the
// coordinator alone would miss it.
function syncQueueSignals(
  domainScope: DomainScope,
  onChange: () => void,
): ReadonlyArray<() => () => void> {
  return [
    () => subscribeToDomainSyncCoordinator(domainScope, onChange),
    () => subscribeToPersistedDocuments(domainScope, onChange),
  ];
}

// Each store lives exactly as long as its domain scope, which the SDK rotates
// with the database, signing identity, and sign-in, like the sync coordinator
// and download history whose signals it follows.
const writeStoresByScope = new WeakMap<DomainScope, PendingWriteQueueStore>();
const downloadStoresByScope = new WeakMap<
  DomainScope,
  PendingDownloadQueueStore
>();

/** The durable write queue (unflushed local changes) for one domain scope. */
export function getOrCreatePendingWriteQueueStore(
  domainScope: DomainScope,
): PendingWriteQueueStore {
  const existing = writeStoresByScope.get(domainScope);
  if (existing) return existing;
  const created = createQueueReadStore({
    coalesceMs: WRITE_QUEUE_COALESCE_MS,
    read: (queries: ContainerDocumentQueries) => queries.listPendingWrites(),
    subscribeToChanges: (onChange) =>
      subscribeToAll(syncQueueSignals(domainScope, onChange)),
  });
  writeStoresByScope.set(domainScope, created);
  return created;
}

/**
 * The durable download queue (discovered content not yet pulled) for one
 * domain scope. A recorded completion also re-reads it, so a finished row
 * leaves the pending list.
 */
export function getOrCreatePendingDownloadQueueStore(
  domainScope: DomainScope,
): PendingDownloadQueueStore {
  const existing = downloadStoresByScope.get(domainScope);
  if (existing) return existing;
  const created = createQueueReadStore({
    coalesceMs: DOWNLOAD_QUEUE_COALESCE_MS,
    read: (queries: ContainerDocumentQueries) => queries.listPendingDownloads(),
    subscribeToChanges: (onChange) =>
      subscribeToAll([
        ...syncQueueSignals(domainScope, onChange),
        () => subscribeToDomainDownloadHistory(domainScope, onChange),
      ]),
  });
  downloadStoresByScope.set(domainScope, created);
  return created;
}
