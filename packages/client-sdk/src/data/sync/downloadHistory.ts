import type { DomainScope } from "../shared/domainScope";
import { createListenerSet } from "../shared/listenerSet";

/**
 * A pull that left the download queue with its content fully stored, with
 * what a host needs to list and open it: a document's container (null when
 * it is orphaned), a folder's name, and a file's name and stored blob.
 */
export type CompletedDownloadItem =
  | {
      readonly localId: string;
      readonly documentId: string;
      readonly objectKind: "document";
      readonly title: string | null;
      readonly containerId: string | null;
    }
  | {
      readonly localId: string;
      readonly documentId: string;
      readonly objectKind: "container";
      readonly title: string | null;
    }
  | {
      readonly localId: string;
      readonly documentId: string;
      readonly objectKind: "attachment";
      readonly slotId: string;
      readonly fileName: string;
      /** The owning document's title. */
      readonly title: string;
      /** The owning document's container. */
      readonly containerId: string | null;
      readonly storageKey: string;
      /** Null until the server blob identity is known. */
      readonly blobId: string | null;
    };

/** The downloads this scope saw finish, newest first. */
export interface DomainDownloadHistorySnapshot {
  readonly completed: ReadonlyArray<CompletedDownloadItem>;
}

export interface DomainDownloadHistory {
  getSnapshot: () => DomainDownloadHistorySnapshot;
  /** A download finished; a repeat of the same item moves it to the front. */
  recordCompleted: (item: CompletedDownloadItem) => void;
  subscribe: (listener: () => void) => () => void;
}

// The newest completions kept, so a large first hydration cannot grow the
// history without bound.
const MAX_COMPLETED_DOWNLOADS = 2000;

function completedDownloadKey(item: CompletedDownloadItem): string {
  return item.objectKind === "attachment"
    ? `attachment:${item.localId}:${item.slotId}`
    : `${item.objectKind}:${item.localId}`;
}

function createDomainDownloadHistory(): DomainDownloadHistory {
  const listeners = createListenerSet();
  let snapshot: DomainDownloadHistorySnapshot = { completed: [] };
  return {
    getSnapshot: () => snapshot,
    recordCompleted(item) {
      const key = completedDownloadKey(item);
      snapshot = {
        completed: [
          item,
          ...snapshot.completed.filter(
            (entry) => completedDownloadKey(entry) !== key,
          ),
        ].slice(0, MAX_COMPLETED_DOWNLOADS),
      };
      listeners.notify();
    },
    subscribe: listeners.subscribe,
  };
}

// Like the sync coordinator whose lanes run these pulls, the history lives
// exactly as long as the domain scope, which the SDK rotates with the
// database, signing identity, and sign-in. It is recorded whether or not a
// host is watching.
const historiesByScope = new WeakMap<DomainScope, DomainDownloadHistory>();

export function getOrCreateDomainDownloadHistory(
  domainScope: DomainScope,
): DomainDownloadHistory {
  const existing = historiesByScope.get(domainScope);
  if (existing) return existing;
  const created = createDomainDownloadHistory();
  historiesByScope.set(domainScope, created);
  return created;
}

export function recordDomainCompletedDownload(
  domainScope: DomainScope,
  item: CompletedDownloadItem,
): void {
  getOrCreateDomainDownloadHistory(domainScope).recordCompleted(item);
}

export function getDomainDownloadHistorySnapshot(
  domainScope: DomainScope,
): DomainDownloadHistorySnapshot {
  return getOrCreateDomainDownloadHistory(domainScope).getSnapshot();
}

export function subscribeToDomainDownloadHistory(
  domainScope: DomainScope,
  listener: () => void,
): () => void {
  return getOrCreateDomainDownloadHistory(domainScope).subscribe(listener);
}
