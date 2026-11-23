import type { DocumentSummary } from "../../data/documents/documentSummary";
import type { OrganizationSyncPauseSubject } from "../../data/sync/organizationSyncPauses";
import type { LocalProjectionStore } from "../../stores/local-projection";

/** One discovered document to open, keyed as the container's listing names it. */
export interface DiscoveredDocumentTarget {
  readonly containerId: string;
  readonly documentId: string;
  readonly localId: string;
}

/** What the primer needs from its scope; the composition root wires it. */
export interface DiscoveredDocumentPrimerHost {
  /** The scope's local projection, which reconciliation fills. */
  readonly projection: Pick<
    LocalProjectionStore,
    "getSnapshot" | "onReconcileSignal" | "subscribe"
  >;
  /**
   * Whether remote sync can run for this scope now: its database is ready,
   * the session is authenticated and online, and the runtime still belongs to
   * this scope. Opening a store offline or in local-only mode pulls nothing.
   */
  readonly canPrime: () => boolean;
  /** Reads the scope's organization sync pauses; rejects when unreadable. */
  readonly loadSyncPauses: () => Promise<void>;
  readonly isContainerPaused: (
    container: OrganizationSyncPauseSubject,
  ) => boolean;
  readonly subscribeToSyncPauses: (listener: () => void) => () => void;
  /** Opens each document's store, which pulls its content and attachments. */
  readonly openDocuments: (
    targets: ReadonlyArray<DiscoveredDocumentTarget>,
  ) => void;
}

function documentTargets(
  summaries: ReadonlyArray<DocumentSummary>,
): DiscoveredDocumentTarget[] {
  return summaries.flatMap((summary) =>
    summary.containerId && summary.documentId
      ? [
          {
            containerId: summary.containerId,
            documentId: summary.documentId,
            localId: summary.id,
          },
        ]
      : [],
  );
}

/**
 * Opens the store of every document reconciliation discovers, so content and
 * attachments arrive in the background whichever view is showing. Opening a
 * store is what pulls a document; nothing else does for ordinary documents.
 *
 * Each summary list the projection publishes is opened once. The projection
 * swaps a container's list when its documents change, so a new list is new
 * work and an unchanged one is not reopened.
 *
 * A container whose organization the user paused in Shared with Me is skipped
 * and left unmarked, so resuming opens it. While the pause set cannot be read,
 * nothing is opened: like the sync lanes, the primer cannot tell which
 * organizations to hold, so it holds them all until a later pass reads it.
 *
 * Returns a stop function. Stores already opened keep syncing after it.
 */
export function startDiscoveredDocumentPrimer(
  host: DiscoveredDocumentPrimerHost,
): () => void {
  const primed = new WeakSet<ReadonlyArray<DocumentSummary>>();
  let stopped = false;
  let scheduled = false;
  let running = false;
  let rerun = false;

  const primeReadyLists = (): void => {
    const snapshot = host.projection.getSnapshot();
    const containersById = new Map(
      snapshot.containers.map((container) => [container.id, container]),
    );
    const targets: DiscoveredDocumentTarget[] = [];
    for (const [
      containerId,
      summaries,
    ] of snapshot.documentSummariesByContainerId) {
      if (summaries.length === 0 || primed.has(summaries)) continue;
      const container = containersById.get(containerId);
      // A list for a container the tree does not hold yet cannot be checked
      // against the pauses. Hold it; a later pass sees the container.
      if (!container || host.isContainerPaused(container)) continue;
      primed.add(summaries);
      targets.push(...documentTargets(summaries));
    }
    if (targets.length > 0) host.openDocuments(targets);
  };

  const canPrime = (): boolean => !stopped && host.canPrime();

  /** One pass; false when it held everything and later passes must wait. */
  const prime = async (): Promise<boolean> => {
    if (!canPrime()) return false;
    try {
      await host.loadSyncPauses();
    } catch {
      // Unreadable pauses hold every organization. The next projection
      // change, regained prerequisite, or pause change reads them again.
      return false;
    }
    if (!canPrime()) return false;
    primeReadyLists();
    return true;
  };

  // One pass at a time; a trigger during a pass's pause read runs one more.
  const run = async (): Promise<void> => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
      } while ((await prime()) && rerun);
    } finally {
      running = false;
    }
  };

  // Coalesce bursts of projection changes into one pass, and never open
  // stores from inside the projection's own notification.
  const schedule = (): void => {
    if (stopped || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void run();
    });
  };

  const unsubscribeProjection = host.projection.subscribe(schedule);
  const unsubscribeSignals = host.projection.onReconcileSignal(schedule);
  const unsubscribePauses = host.subscribeToSyncPauses(schedule);
  schedule();

  return () => {
    stopped = true;
    unsubscribeProjection();
    unsubscribeSignals();
    unsubscribePauses();
  };
}
