import { loadLocalContainerProjectionDocumentsFromRuntime } from "../../workflows/container-contents/projectionView";
import { didRegainSyncPrerequisites } from "../../workflows/container-contents/syncLane";
import {
  isReconcilableContainerNode,
  isRemoteBackedContainerNode,
} from "../container-contents/reconcilableContainer";
import type { ContainerContentsStoreRuntime } from "../container-contents/syncAgent";
import type { ContainerContentsStore } from "../container-contents/types";
import {
  applyContainerSummaries,
  createSummaryCache,
  removeDocumentSummary,
  resetSummaryCache,
  type SummaryCache,
  snapshotLinkedContainerIdsByDocumentId,
  snapshotSummariesByContainerId,
} from "./summaryCache";
import type {
  LocalProjectionReconciledDelta,
  LocalProjectionSnapshot,
} from "./types";

/**
 * Signals the local projection store raises so the background reconciler
 * (Layer B) knows what to sync. The store never performs remote I/O itself.
 */
export interface LocalProjectionReconcileSignal {
  reason:
    | "hydrated"
    | "active-changed"
    | "prerequisites-regained"
    | "remote-containers-added";
  activeContainerId: string | null;
}

export type LocalProjectionReconcileListener = (
  signal: LocalProjectionReconcileSignal,
) => void;

export interface LocalProjectionStore {
  getSnapshot: () => LocalProjectionSnapshot;
  subscribe: (listener: () => void) => () => void;
  setActiveContainer: (containerId: string | null) => void;
  getActiveContainerId: () => string | null;
  applyReconciled: (delta: LocalProjectionReconciledDelta) => void;
  removePersistedDocument: (localId: string) => void;
  updateRuntime: (runtime: ContainerContentsStoreRuntime) => void;
  /** Registered by the reconciler; returns an unsubscribe handle. */
  onReconcileSignal: (listener: LocalProjectionReconcileListener) => () => void;
  getContainerStore: () => ContainerContentsStore;
}

interface LocalProjectionStoreState {
  activeContainerId: string | null;
  cache: SummaryCache;
  containerStore: ContainerContentsStore;
  hydratedContainerSummaries: boolean;
  listeners: Set<() => void>;
  /**
   * A sync-prerequisite regain (auth, connectivity, or key pair) that arrived
   * before the container tree was ready. The signal's reset-and-backfill must
   * not be lost to startup ordering, so it is latched here and flushed once
   * hydration completes.
   */
  pendingPrerequisitesRegained: boolean;
  reconcileListeners: Set<LocalProjectionReconcileListener>;
  runtime: ContainerContentsStoreRuntime;
  snapshot: LocalProjectionSnapshot;
  summaryLoadByContainerId: Map<string, Promise<void>>;
}

const EMPTY_SNAPSHOT: LocalProjectionSnapshot = {
  ready: false,
  containers: [],
  documentSummariesByContainerId: new Map(),
  linkedContainerIdsByDocumentId: new Map(),
};

function computeSnapshot(
  state: LocalProjectionStoreState,
): LocalProjectionSnapshot {
  const containerSnapshot = state.containerStore.getSnapshot();
  return {
    ready: containerSnapshot.ready,
    containers: containerSnapshot.nodes,
    documentSummariesByContainerId: snapshotSummariesByContainerId(state.cache),
    linkedContainerIdsByDocumentId: snapshotLinkedContainerIdsByDocumentId(
      state.cache,
    ),
  };
}

function emit(state: LocalProjectionStoreState): void {
  state.snapshot = computeSnapshot(state);
  for (const listener of state.listeners) {
    try {
      listener();
    } catch {
      // Keep one subscriber failure from blocking later subscribers.
    }
  }
}

function notifyReconcile(
  state: LocalProjectionStoreState,
  signal: LocalProjectionReconcileSignal,
): void {
  for (const listener of state.reconcileListeners) {
    try {
      listener(signal);
    } catch {
      // Reconciler failures must not break the read path.
    }
  }
}

function loadActiveContainerSummaries(
  state: LocalProjectionStoreState,
  containerId: string,
): void {
  if (
    state.cache.hydratedContainerIds.has(containerId) ||
    state.summaryLoadByContainerId.has(containerId) ||
    state.runtime.infra.dbStatus !== "ready"
  ) {
    return;
  }

  const loadPromise: Promise<void> =
    loadLocalContainerProjectionDocumentsFromRuntime({
      containerIds: [containerId],
      runtime: state.runtime,
    })
      .then((documents) => {
        // A runtime reset (e.g. dbStatus loss) clears this entry and the cache
        // mid-flight; do not apply a stale read to a freshly reset cache.
        if (state.summaryLoadByContainerId.get(containerId) !== loadPromise) {
          return;
        }
        const changed = applyContainerSummaries(state.cache, {
          containerId,
          documentSummaries: documents.documentSummaries,
          linkedContainerIdsByDocumentId:
            documents.linkedContainerIdsByDocumentId,
        });
        if (changed) {
          emit(state);
        }
      })
      .catch(() => {
        // Local read failures fall back to an empty list; the reconciler retries.
      })
      .finally(() => {
        if (state.summaryLoadByContainerId.get(containerId) === loadPromise) {
          state.summaryLoadByContainerId.delete(containerId);
        }
      });

  state.summaryLoadByContainerId.set(containerId, loadPromise);
}

function markHydratedIfReady(state: LocalProjectionStoreState): boolean {
  if (
    state.hydratedContainerSummaries ||
    state.runtime.infra.dbStatus !== "ready" ||
    !state.containerStore.getSnapshot().ready
  ) {
    return false;
  }

  state.hydratedContainerSummaries = true;
  if (state.activeContainerId) {
    loadActiveContainerSummaries(state, state.activeContainerId);
  }
  notifyReconcile(state, {
    reason: "hydrated",
    activeContainerId: state.activeContainerId,
  });
  return true;
}

function flushPendingPrerequisitesRegained(
  state: LocalProjectionStoreState,
): void {
  if (
    !state.pendingPrerequisitesRegained ||
    !state.hydratedContainerSummaries ||
    !state.containerStore.getSnapshot().ready
  ) {
    return;
  }
  state.pendingPrerequisitesRegained = false;
  notifyReconcile(state, {
    reason: "prerequisites-regained",
    activeContainerId: state.activeContainerId,
  });
}

function hasRemoteBackedContainerMembershipGrowth(
  previous: LocalProjectionSnapshot["containers"],
  next: LocalProjectionSnapshot["containers"],
  homeOrganizationId: string | null,
  activeContainerId: string | null,
): boolean {
  const isRemoteReconcilable = (
    container: LocalProjectionSnapshot["containers"][number],
  ) => isReconcilableContainerNode(container, homeOrganizationId);
  const previousIds = new Set(
    previous.flatMap((container) =>
      isRemoteReconcilable(container) ? [container.id] : [],
    ),
  );
  if (
    next.some(
      (container) =>
        isRemoteReconcilable(container) && !previousIds.has(container.id),
    )
  ) {
    return true;
  }
  if (!activeContainerId) {
    return false;
  }
  const wasActiveRemoteBacked = previous.some(
    (container) =>
      container.id === activeContainerId &&
      isRemoteBackedContainerNode(container),
  );
  return (
    !wasActiveRemoteBacked &&
    next.some(
      (container) =>
        container.id === activeContainerId &&
        isRemoteBackedContainerNode(container),
    )
  );
}

function removePersistedDocumentFromCache(
  state: LocalProjectionStoreState,
  localId: string,
): void {
  if (removeDocumentSummary(state.cache, localId)) {
    emit(state);
  }
}

export function createLocalProjectionStore(input: {
  containerStore: ContainerContentsStore;
  runtime: ContainerContentsStoreRuntime;
}): LocalProjectionStore {
  const state: LocalProjectionStoreState = {
    activeContainerId: null,
    cache: createSummaryCache(),
    containerStore: input.containerStore,
    hydratedContainerSummaries: false,
    listeners: new Set(),
    pendingPrerequisitesRegained: false,
    reconcileListeners: new Set(),
    runtime: input.runtime,
    snapshot: EMPTY_SNAPSHOT,
    summaryLoadByContainerId: new Map(),
  };
  state.snapshot = computeSnapshot(state);

  // Re-emit whenever the underlying container tree changes (mutations, remote
  // hydration). This keeps the merged snapshot in step with the tree store.
  input.containerStore.subscribe(() => {
    const previousContainers = state.snapshot.containers;
    const didMarkHydrated = markHydratedIfReady(state);
    emit(state);
    // Flush only after emit has recomputed the snapshot: the backfill the
    // signal triggers enumerates known containers from getSnapshot(), so
    // flushing earlier would run it over the stale pre-hydration list.
    flushPendingPrerequisitesRegained(state);
    // Authentication can schedule the initial idle backfill before the
    // asynchronous remote tree crawl discovers this identity's real root and
    // system children. Re-arm backfill after those remotely-listable ids become
    // visible. Compare membership, not node objects, so metadata/sync-state
    // churn cannot create a reconciliation loop.
    if (
      !didMarkHydrated &&
      hasRemoteBackedContainerMembershipGrowth(
        previousContainers,
        state.snapshot.containers,
        state.runtime.auth.organizationId,
        state.activeContainerId,
      )
    ) {
      notifyReconcile(state, {
        reason: "remote-containers-added",
        activeContainerId: state.activeContainerId,
      });
    }
  });

  return {
    getSnapshot: () => state.snapshot,
    subscribe: (listener) => {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
    setActiveContainer: (containerId) => {
      if (state.activeContainerId === containerId) {
        return;
      }
      state.activeContainerId = containerId;
      if (containerId) {
        loadActiveContainerSummaries(state, containerId);
      }
      notifyReconcile(state, {
        reason: "active-changed",
        activeContainerId: containerId,
      });
    },
    getActiveContainerId: () => state.activeContainerId,
    applyReconciled: (delta) => {
      if (applyContainerSummaries(state.cache, delta)) {
        emit(state);
      }
    },
    removePersistedDocument: (localId) =>
      removePersistedDocumentFromCache(state, localId),
    updateRuntime: (runtime) => {
      const previousRuntime = state.runtime;
      state.runtime = runtime;
      state.containerStore.updateRuntime(runtime);

      // Latch before the readiness checks so a regain that arrives while the
      // database or container tree is still warming up is flushed after
      // hydration instead of being lost to startup ordering.
      if (didRegainSyncPrerequisites(previousRuntime, runtime)) {
        state.pendingPrerequisitesRegained = true;
      }

      if (runtime.infra.dbStatus !== "ready") {
        resetSummaryCache(state.cache);
        state.summaryLoadByContainerId.clear();
        state.hydratedContainerSummaries = false;
        emit(state);
        return;
      }

      // Reload the active container's summaries when the local store becomes
      // ready (e.g. first DB attach) so first paint reflects cached contents.
      markHydratedIfReady(state);
      emit(state);
      // After emit, so the triggered backfill reads the refreshed snapshot.
      flushPendingPrerequisitesRegained(state);
    },
    onReconcileSignal: (listener) => {
      state.reconcileListeners.add(listener);
      return () => {
        state.reconcileListeners.delete(listener);
      };
    },
    getContainerStore: () => state.containerStore,
  };
}
