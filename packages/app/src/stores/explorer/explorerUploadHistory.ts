import {
  type ContainerDocumentQueries,
  type DomainScope,
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import {
  type ExplorerUploadItem,
  type ExplorerUploadItemEvent,
  isOutstandingUploadItem,
  transitionExplorerUploadItem,
} from "./explorerUploadItemMachine";

type UploadConfirmationQueries = Pick<
  ContainerDocumentQueries,
  "loadDocumentSyncState"
>;

// Oldest settled items are trimmed past this so a long session cannot grow the
// list without bound; outstanding (queued/importing) items are never trimmed.
const MAX_RETAINED_UPLOAD_ITEMS = 2000;

/**
 * Every file uploaded in one domain scope, oldest first. Upload managers add
 * and advance items; the history itself confirms an imported file once its
 * document lane completes and the SDK reports nothing left to sync, so a
 * finished upload turns Complete even while no Uploads view is open.
 */
export interface ExplorerUploadHistory {
  add: (items: ReadonlyArray<ExplorerUploadItem>) => void;
  dispatch: (itemIds: Iterable<string>, event: ExplorerUploadItemEvent) => void;
  getSnapshot: () => ReadonlyArray<ExplorerUploadItem>;
  /** Unique across every manager that shares this scope. */
  nextItemId: () => string;
  /** The queries confirmations read; the newest manager's win. */
  setDocumentQueries: (queries: UploadConfirmationQueries) => void;
  subscribe: (listener: () => void) => () => void;
}

function trimRetainedUploadItems(
  items: ReadonlyArray<ExplorerUploadItem>,
): ReadonlyArray<ExplorerUploadItem> {
  const excess = items.length - MAX_RETAINED_UPLOAD_ITEMS;
  if (excess <= 0) {
    return items;
  }
  const trimmed: ExplorerUploadItem[] = [];
  let toDrop = excess;
  for (const item of items) {
    if (toDrop > 0 && !isOutstandingUploadItem(item)) {
      toDrop -= 1;
      continue;
    }
    trimmed.push(item);
  }
  return trimmed;
}

function createExplorerUploadHistory(
  domainScope: DomainScope,
): ExplorerUploadHistory {
  let items: ReadonlyArray<ExplorerUploadItem> = [];
  let nextId = 0;
  let queries: UploadConfirmationQueries | null = null;
  let stopWatching: (() => void) | null = null;
  const listeners = new Set<() => void>();
  // The lane run each imported item was last checked after, so one completed
  // run is confirmed at most once.
  const checkedRunByItemId = new Map<string, number>();

  function publish(next: ReadonlyArray<ExplorerUploadItem>) {
    if (next === items) return;
    items = next;
    for (const listener of listeners) listener();
    watchWhileImported();
  }

  function dispatch(itemIds: Iterable<string>, event: ExplorerUploadItemEvent) {
    const ids = new Set(itemIds);
    let changed = false;
    const next = items.map((item) => {
      if (!ids.has(item.id)) return item;
      const updated = transitionExplorerUploadItem(item, event);
      if (updated !== item) changed = true;
      return updated;
    });
    if (changed) publish(next);
  }

  // Follow the sync coordinator only while an imported item awaits its
  // confirmation, so a settled history costs nothing.
  function watchWhileImported() {
    const awaiting = items.some((item) => item.status === "imported");
    if (awaiting) {
      stopWatching ??= subscribeToDomainSyncCoordinator(
        domainScope,
        checkLanes,
      );
      // A lane may already be complete when its item is imported.
      checkLanes();
    } else if (stopWatching !== null) {
      stopWatching();
      stopWatching = null;
      checkedRunByItemId.clear();
    }
  }

  function checkLanes() {
    if (queries === null) return;
    const lanes = new Map(
      getDomainSyncCoordinatorSnapshot(domainScope).lanes.map((lane) => [
        lane.key,
        lane,
      ]),
    );
    for (const item of items) {
      if (item.status !== "imported" || item.localId === null) continue;
      const lane = lanes.get(`documents:${item.localId}`);
      if (lane?.status !== "complete") continue;
      if (checkedRunByItemId.get(item.id) === lane.runCount) continue;
      checkedRunByItemId.set(item.id, lane.runCount);
      void confirmUpload(queries, item.id, item.localId);
    }
  }

  async function confirmUpload(
    source: UploadConfirmationQueries,
    itemId: string,
    localId: string,
  ) {
    try {
      const syncState = await source.loadDocumentSyncState(localId);
      // The transition ignores a confirmation for an item that has since
      // failed or already been settled.
      if (syncState === null) {
        // Deleted before it synced: nothing is left to confirm or watch.
        dispatch([itemId], { type: "document-missing" });
      } else if (syncState.status === "synced") {
        dispatch([itemId], { type: "upload-confirmed" });
      }
    } catch {
      // The next completed run of the lane checks again.
    }
  }

  return {
    add(added) {
      if (added.length > 0)
        publish(trimRetainedUploadItems([...items, ...added]));
    },
    dispatch,
    getSnapshot: () => items,
    nextItemId() {
      nextId += 1;
      return `upload-${nextId}`;
    },
    setDocumentQueries(next) {
      if (next === queries) return;
      queries = next;
      watchWhileImported();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Kept for exactly the domain scope's lifetime, like the Downloads history and
// the sync coordinator whose lanes Sync Lanes lists.
const historiesByScope = new WeakMap<DomainScope, ExplorerUploadHistory>();

export function getOrCreateExplorerUploadHistory(
  domainScope: DomainScope,
): ExplorerUploadHistory {
  const existing = historiesByScope.get(domainScope);
  if (existing) return existing;
  const created = createExplorerUploadHistory(domainScope);
  historiesByScope.set(domainScope, created);
  return created;
}
