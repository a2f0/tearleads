import type { DocumentSummary } from "../../data/documentSummary";
import type { DomainScope } from "../../data/domainScope";
import type { LocalProjectionReconciledDelta } from "../../stores/local-projection";
import type { InitialDocumentProbeHost } from "./initialDocumentProbe";
import type { ReconcilePriority } from "./queue";

export interface ReconciliationRuntimeStatus {
  dbStatus: string;
  isAuthenticated: boolean;
  online: boolean;
}

/**
 * Host contract injected by the device-first facade. Keeps the reconciler
 * React-free and decoupled from runtime/persistence construction — it only
 * orchestrates *when* these run and routes their results into Layer A.
 */
export interface ReconciliationHost extends InitialDocumentProbeHost {
  domainScope: DomainScope;
  getRuntimeStatus: () => ReconciliationRuntimeStatus;
  /** True when this container has enough remote state to list documents. */
  canDiscoverContainerDocuments: (containerId: string) => boolean;
  /** Known container ids eligible for idle document reconciliation. */
  listKnownContainerIds: () => ReadonlyArray<string>;
  /** Known ids eligible after an automatic root-lane discovery hint. */
  listAutomaticRootCatchupContainerIds: () => ReadonlyArray<string>;
  /** Discover + persist a container's documents from the server. */
  discoverContainerDocuments: (containerId: string) => Promise<unknown>;
  /** Read a container's freshly-persisted summaries+links from SQLite. */
  loadContainerDelta: (
    containerId: string,
  ) => Promise<LocalProjectionReconciledDelta>;
  /** Push a reconciled delta into the local projection store. */
  applyReconciled: (delta: LocalProjectionReconciledDelta) => void;
  /**
   * Sync document bodies for a reconciled container. `force` (an explicit
   * refresh) revalidates registered ordinary documents and retries system
   * documents; otherwise only unopened system documents are synced, so a
   * background pass can materialize projection-owned content without eagerly
   * opening every ordinary document.
   */
  requestDocumentContentPull?: (
    containerId: string,
    documents: ReadonlyArray<DocumentSummary>,
    force: boolean,
  ) => void;
  /** Refresh the container tree from the server (explicit refresh). */
  refreshTree: () => Promise<void>;
  /** Refresh only the top-level root lane from the server. */
  refreshRootTree: () => Promise<void>;
  /** True if the destroyed-db error should be swallowed rather than surfaced. */
  isIgnorableError: (error: unknown) => boolean;
}

export interface ReconciliationService {
  start: () => void;
  setActiveContainer: (containerId: string | null) => void;
  enqueueContainer: (
    containerId: string,
    priority: ReconcilePriority,
    force?: boolean,
  ) => void;
  enqueueIdleBackfill: () => void;
  /**
   * Forget which containers were reconciled this session so the next enqueue of
   * each re-validates against the server exactly once. Call on the
   * cannot-reconcile → can-reconcile edge (relogin/reconnect): the discovered
   * set is a per-session suppression cache, a previously-visited container may
   * have changed remotely, and initial-probe listings that exhausted their
   * retries need a fresh opportunity once the server is reachable again.
   */
  resetDiscovered: () => void;
  reconcileRootContainersNow: () => Promise<void>;
  reconcileNow: () => Promise<void>;
  stop: () => void;
}
