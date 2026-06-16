import { loadLocalContainerProjectionDocumentsFromRuntime } from "../../workflows/container-contents/projectionView";
import type { ContainerContentsStoreRuntime } from "../container-contents/syncAgent";
import type { ContainerContentsStore } from "../container-contents/types";
import {
  applyContainerSummaries,
  createSummaryCache,
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
  reason: "hydrated" | "active-changed" | "prerequisites-regained";
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

  const loadPromise = loadLocalContainerProjectionDocumentsFromRuntime({
    containerIds: [containerId],
    runtime: state.runtime,
  })
    .then((documents) => {
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
      state.summaryLoadByContainerId.delete(containerId);
    });

  state.summaryLoadByContainerId.set(containerId, loadPromise);
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
    reconcileListeners: new Set(),
    runtime: input.runtime,
    snapshot: EMPTY_SNAPSHOT,
    summaryLoadByContainerId: new Map(),
  };
  state.snapshot = computeSnapshot(state);

  // Re-emit whenever the underlying container tree changes (mutations, remote
  // hydration). This keeps the merged snapshot in step with the tree store.
  input.containerStore.subscribe(() => {
    emit(state);
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
      const changed = applyContainerSummaries(state.cache, {
        containerId: delta.containerId,
        documentSummaries: delta.documentSummaries,
        linkedContainerIdsByDocumentId: delta.linkedContainerIdsByDocumentId,
      });
      if (changed) {
        emit(state);
      }
    },
    updateRuntime: (runtime) => {
      const previousRuntime = state.runtime;
      state.runtime = runtime;
      state.containerStore.updateRuntime(runtime);

      if (runtime.infra.dbStatus !== "ready") {
        resetSummaryCache(state.cache);
        state.summaryLoadByContainerId.clear();
        state.hydratedContainerSummaries = false;
        emit(state);
        return;
      }

      // Reload the active container's summaries when the local store becomes
      // ready (e.g. first DB attach) so first paint reflects cached contents.
      if (
        !state.hydratedContainerSummaries &&
        state.containerStore.getSnapshot().ready
      ) {
        state.hydratedContainerSummaries = true;
        if (state.activeContainerId) {
          loadActiveContainerSummaries(state, state.activeContainerId);
        }
        notifyReconcile(state, {
          reason: "hydrated",
          activeContainerId: state.activeContainerId,
        });
      } else if (
        didRegainRemotePrerequisites(previousRuntime, runtime) &&
        state.containerStore.getSnapshot().ready
      ) {
        notifyReconcile(state, {
          reason: "prerequisites-regained",
          activeContainerId: state.activeContainerId,
        });
      }

      emit(state);
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

function didRegainRemotePrerequisites(
  previous: ContainerContentsStoreRuntime,
  next: ContainerContentsStoreRuntime,
): boolean {
  const becameAuthenticated =
    !previous.auth.isAuthenticated && next.auth.isAuthenticated;
  const cameOnline = !previous.state.online && next.state.online;
  return becameAuthenticated || cameOnline;
}
