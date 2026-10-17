import type { DocumentSummary } from "../../data/documents/documentSummary";
import type { DomainScope } from "../../data/domainScope";
import type { SyncLane, SyncLaneConfig } from "../../data/sync/syncLaneConfig";
import type { LocalProjectionReconciledDelta } from "../../stores/local-projection";
import type { InitialDocumentProbeHost } from "./initialDocumentProbe";
import type { ReconcilePriority } from "./queue";

/** One container a reconciliation pass lists, with its per-lane callbacks. */
export interface ContainerDiscoveryRequest {
  readonly containerId: string;
  readonly onFullListing?:
    | ((documentIds: ReadonlyArray<string>) => void)
    | undefined;
  readonly onPendingDiscovery?: ((delayMs: number) => void) | undefined;
}

/** A discovered lane: `null` means it was not fully listed or applied nothing. */
export type ContainerDiscoveryOutcome =
  | {
      readonly containerId: string;
      readonly status: "fulfilled";
      readonly value: ReadonlyArray<DocumentSummary> | null;
    }
  | {
      readonly containerId: string;
      readonly reason: unknown;
      readonly status: "rejected";
    };

export interface ReconciliationRuntimeStatus {
  dbStatus: string;
  isAuthenticated: boolean;
  online: boolean;
}

/**
 * Host contract injected by the device-first facade. Keeps the reconciler
 * React-free and decoupled from runtime/persistence construction — it only
 * orchestrates *when* these run and routes their results into Layer A. The
 * host also supplies the coordinator lane and the clock, so the reconciler
 * imports no runtime code from the client, store, workflow, or coordinator
 * layers; `lint:architecture` enforces this.
 */
export interface ReconciliationHost extends InitialDocumentProbeHost {
  domainScope: DomainScope;
  /**
   * Register the reconciler's lane on the scope's sync coordinator. The host
   * owns the coordinator; the reconciler only schedules work on its lane.
   */
  registerLane: (key: string, config: SyncLaneConfig) => SyncLane;
  getRuntimeStatus: () => ReconciliationRuntimeStatus;
  /** True when this container has enough remote state to list documents. */
  canDiscoverContainerDocuments: (containerId: string) => boolean;
  /** Known container ids eligible for idle document reconciliation. */
  listKnownContainerIds: () => ReadonlyArray<string>;
  /** Known ids eligible after an automatic root-lane discovery hint. */
  listAutomaticRootCatchupContainerIds: () => ReadonlyArray<string>;
  /**
   * Discover + persist documents for every requested container through one
   * batched listing. Each lane's outcome is handed to `onOutcome` (awaited)
   * as soon as it applies, before later lanes apply; every outcome is also
   * returned.
   */
  discoverContainerDocuments: (
    requests: ReadonlyArray<ContainerDiscoveryRequest>,
    onOutcome: (outcome: ContainerDiscoveryOutcome) => Promise<void>,
  ) => Promise<ReadonlyArray<ContainerDiscoveryOutcome>>;
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
   * opening every ordinary document. A documentIds set limits forced pulls to
   * hint-named documents while still discovering new system content.
   */
  requestDocumentContentPull: (
    containerId: string,
    documents: ReadonlyArray<DocumentSummary>,
    force: boolean,
    documentIds?: ReadonlySet<string>,
  ) => void;
  /** Refresh the container tree from the server (explicit refresh). */
  refreshTree: () => Promise<void>;
  /** Refresh only the top-level root lane from the server. */
  refreshRootTree: () => Promise<void>;
  /** True if the destroyed-db error should be swallowed rather than surfaced. */
  isIgnorableError: (error: unknown) => boolean;
  /** Host diagnostics sink; bare runtimes do not structure errors. */
  logError?: ((message: string, error: unknown) => void) | undefined;
}

export interface ReconciliationService {
  start: () => void;
  setActiveContainer: (containerId: string | null) => void;
  /** Force a listing; documentId limits content revalidation to that hint. */
  enqueueContainer: (
    containerId: string,
    priority: ReconcilePriority,
    force?: boolean,
    documentId?: string,
  ) => void;
  /** Queue known containers at idle priority. */
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
  /**
   * Re-list root containers and reconcile the root catch-up set. By default a
   * request joins a sweep already in flight. With `freshListing`, the returned
   * sweep starts after this call: a discovery event (a root shared with or
   * created for this user) must not be satisfied by a sweep that may have
   * listed roots before the event committed.
   */
  reconcileRootContainersNow: (options?: {
    readonly freshListing?: boolean;
  }) => Promise<void>;
  reconcileNow: () => Promise<void>;
  stop: () => void;
}
