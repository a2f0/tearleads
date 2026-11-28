import type { DomainScope } from "../../data/shared/domainScope";
import { getOrCreateOrganizationSyncPauses } from "../../data/sync/organizationSyncPauses";
import {
  classifyDatabaseFailure,
  type DomainSyncCoordinator,
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
} from "../../data/sync/syncCoordinator";
import {
  type ContainerContentsStore,
  type ContainerContentsStoreOptions,
  isAutomaticRootCatchupContainerNode,
  isRemoteBackedContainerNode,
} from "../../stores/container-contents";
import { openDocumentStore } from "../../stores/documents";
import {
  requestRegisteredDocumentRemoteSync,
  subscribeToPersistedDocumentDeletions,
  subscribeToPersistedDocuments,
} from "../../stores/documents/registry";
import {
  getOrCreateLocalProjectionStore,
  type LocalProjectionStore,
  type LocalProjectionView,
} from "../../stores/local-projection";
import {
  connectReconciliationTriggers,
  createReconciliationService,
  type ReconciliationHost,
  type ReconciliationService,
  systemReconciliationClock,
} from "../../sync/reconciliation";
import {
  type ContainerContentsStoreWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
} from "../../workflows/container-contents";
import { listOwedDocumentLaneContainerIds } from "../../workflows/container-contents/documentDiscovery/documentLaneDiscovery";
import { probeUndiscoveredRemoteDocumentBatch } from "../../workflows/container-contents/documentPriming/documentHydrationProbe";
import {
  type ContainerContents,
  createContainerContentsStoreRuntime as createDeviceFirstWorkflowRuntime,
} from "../containerContents";
import { discoverContainerDocumentLanesForRuntime } from "../containerContents/documentDiscovery";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import {
  type DiscoveredDocumentPrimerHost,
  startDiscoveredDocumentPrimer,
} from "./discoveredDocumentPrimer";
import {
  createListingCoverageHost,
  createProbeLaneListing,
  installDocumentListingAuthority,
  listReconcilableContainerIds,
} from "./listingCoverageHost";
import { createReconciledDocumentContentPuller } from "./reconciledDocumentContentPull";

export type { LocalProjectionView } from "../../stores/local-projection";

/** One domain scope's local read, local-write, and reconciliation handles. */
export interface DeviceFirstContainerContents {
  /**
   * Locally durable container tree and mutation store. Ordinary tree writes
   * update this store after local persistence and queue remote convergence in
   * the background; security-sensitive remote operations keep their explicit
   * online requirements.
   */
  readonly containerStore: ContainerContentsStore;
  /** Background remote reconciliation; never awaited for first paint. */
  readonly reconciler: ReconciliationService;
  /** Synchronously readable container/document projection. */
  readonly view: LocalProjectionView;
}

/**
 * Device-first facade. Opens a shared scope that pairs immediate local reads
 * and locally durable writes with background remote convergence.
 */
export interface DeviceFirst {
  /** Open all device-first handles for the current domain scope. */
  open(
    options?: ContainerContentsStoreOptions | undefined,
  ): DeviceFirstContainerContents;
  /** Stop the current scope's reconciler (if one was created) on teardown. */
  dispose(): void;
}

export function createDeviceFirst(
  runtimeService: InternalRuntime,
  containerContents: ContainerContents,
): DeviceFirst {
  return new DeviceFirstService(runtimeService, containerContents);
}

interface DeviceFirstScopeEntry {
  retiring?: boolean;
  coordinator: DomainSyncCoordinator;
  contents: DeviceFirstContainerContents;
  disconnectReconciliationTriggers: () => void;
  removeListingAuthority: () => void;
  stopDocumentPrimer: () => void;
  unsubscribeCoordinatorDisposal: () => void;
  unsubscribePersistedDocumentDeletions: () => void;
  unsubscribePersistedDocuments: () => void;
  unsubscribePublicRuntime: () => void;
}

function stopScopeEntry(entry: DeviceFirstScopeEntry): void {
  entry.unsubscribeCoordinatorDisposal();
  entry.unsubscribePublicRuntime();
  entry.coordinator.dispose();
  entry.contents.reconciler.stop();
  entry.disconnectReconciliationTriggers();
  entry.removeListingAuthority();
  entry.stopDocumentPrimer();
  entry.unsubscribePersistedDocumentDeletions();
  entry.unsubscribePersistedDocuments();
}

function createInitialDocumentProbeHost(
  runtimeService: InternalRuntime,
  domainScope: ReconciliationHost["domainScope"],
  store: LocalProjectionStore,
): Pick<
  ReconciliationHost,
  | "listContainerDocumentIds"
  | "probeUndiscoveredDocumentsBatch"
  | "reportInitialDocumentProbeComplete"
> {
  const syncPauses = getOrCreateOrganizationSyncPauses(domainScope);
  return {
    listContainerDocumentIds: createProbeLaneListing(
      runtimeService,
      domainScope,
      {
        isContainerPaused: (containerId) => {
          const container = store
            .getSnapshot()
            .containers.find((node) => node.id === containerId);
          return !container || syncPauses.isContainerPaused(container);
        },
        loadSyncPauses: (execSql) => syncPauses.load(execSql),
      },
    ),
    probeUndiscoveredDocumentsBatch: async (input) => {
      const runtime = createDeviceFirstWorkflowRuntime(runtimeService);
      return probeUndiscoveredRemoteDocumentBatch({
        ...input,
        host: {
          documentWorkflowRuntime: (containerId) =>
            createContainerContentsDocumentsRuntime(runtime, containerId),
          openDocumentStore: (target) =>
            openDocumentStore(
              domainScope,
              target.localId,
              target.runtime,
              target.documentId,
            ),
        },
        runtime,
      });
    },
    reportInitialDocumentProbeComplete: (requestedCount) => {
      runtimeService
        .workflowInput()
        .util.log(
          `Initial document hydration probe requested ${requestedCount} syncs`,
        );
    },
  };
}

/**
 * Binds the discovered-document primer to one scope: it primes only while
 * this scope's runtime can sync, and honors the scope's organization pauses.
 */
function createDiscoveredDocumentPrimerHost(input: {
  readonly containerContents: ContainerContents;
  readonly domainScope: DomainScope;
  readonly runtimeService: InternalRuntime;
  readonly store: LocalProjectionStore;
}): DiscoveredDocumentPrimerHost {
  const { containerContents, domainScope, runtimeService, store } = input;
  const syncPauses = getOrCreateOrganizationSyncPauses(domainScope);
  return {
    projection: store,
    canPrime: () => {
      const runtime = runtimeService.workflowInput();
      return (
        runtime.state.domainScope === domainScope &&
        runtime.infra.dbStatus === "ready" &&
        runtime.auth.isAuthenticated &&
        runtime.state.online
      );
    },
    loadSyncPauses: () =>
      syncPauses.load(runtimeService.workflowInput().infra.execSql),
    isContainerPaused: (container) => syncPauses.isContainerPaused(container),
    subscribeToSyncPauses: (listener) => syncPauses.subscribe(listener),
    openDocuments: (targets) => {
      const documentLinks = containerContents.documentLinks();
      for (const target of targets) {
        try {
          documentLinks.openDocument(target);
        } catch (error) {
          // One store that cannot open must not keep the rest from syncing.
          logReconciliationFailure(
            createDeviceFirstWorkflowRuntime(runtimeService),
            "Failed to open a discovered document for background sync",
            error,
          );
        }
      }
    },
  };
}

function createConnectionStatusNotifier(runtimeService: InternalRuntime) {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Isolate subscriber failures.
      }
    }
  };
  return {
    notify,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unsubscribeRuntime: runtimeService.publicRuntime.subscribe(notify),
  };
}

class DeviceFirstService implements DeviceFirst {
  // A real Map (not WeakMap) so dispose() can iterate every scope seen this
  // session. A running reconciler holds event subscriptions that keep an idle,
  // stale-scope service (and its scope) reachable anyway, so WeakMap bought no
  // GC here; the entries are released explicitly on dispose().
  private readonly entriesByScope = new Map<
    DomainScope,
    DeviceFirstScopeEntry
  >();

  constructor(
    private readonly runtimeService: InternalRuntime,
    private readonly containerContents: ContainerContents,
  ) {}

  open(
    options?: ContainerContentsStoreOptions | undefined,
  ): DeviceFirstContainerContents {
    return this.getOrCreateEntry(options).contents;
  }

  dispose(): void {
    // Stop every reconciler created this session — not just the current
    // scope's. A scope change (e.g. anonymous -> authenticated) leaves the old
    // scope's reconciler subscribed and its coordinator pump live; tear them
    // all down. Force-stop each scope's coordinator (which runs the reconciler
    // lane) alongside stopping the service.
    const entries = Array.from(this.entriesByScope);
    for (const [, entry] of entries) entry.retiring = true;
    for (const [scope, entry] of entries) this.retireEntry(scope, entry);
  }

  private retireEntry(scope: DomainScope, entry: DeviceFirstScopeEntry): void {
    if (this.entriesByScope.get(scope) !== entry) return;
    this.entriesByScope.delete(scope);
    stopScopeEntry(entry);
  }

  private workflowRuntime(): ContainerContentsStoreWorkflowRuntime {
    return createDeviceFirstWorkflowRuntime(this.runtimeService);
  }

  private getOrCreateEntry(
    options?: ContainerContentsStoreOptions | undefined,
  ): DeviceFirstScopeEntry {
    const runtime = this.workflowRuntime();
    const domainScope = runtime.state.domainScope;
    const existing = this.entriesByScope.get(domainScope);
    if (existing && (existing.retiring || existing.coordinator.isDisposed())) {
      this.retireEntry(domainScope, existing);
      return this.getOrCreateEntry(options);
    }
    if (existing) {
      // Do not call updateRuntime here: facade selectors run during React
      // render, and updateRuntime emits synchronously. Hosts drive runtime
      // updates through view.updateRuntime() from an effect instead.
      return existing;
    }

    const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
    const store = getOrCreateLocalProjectionStore({
      domainScope,
      runtime,
      options,
    });
    // Opening the container store publishes its lane. A subscriber may have
    // finished opening this scope while that notification was in progress.
    if (this.entriesByScope.has(domainScope))
      return this.getOrCreateEntry(options);
    if (coordinator.isDisposed())
      throw new Error("Device-first scope retired during registration");
    const entry = this.buildScopeEntry(store, domainScope, coordinator);
    this.entriesByScope.set(domainScope, entry);
    // Retiring a scope's coordinator (e.g. when database or identity rotates)
    // must tear down this scope's reconciler and subscriptions immediately.
    entry.unsubscribeCoordinatorDisposal = coordinator.subscribe(() => {
      if (coordinator.isDisposed()) {
        this.retireEntry(domainScope, entry);
      }
    });
    entry.contents.reconciler.start();
    const current = this.entriesByScope.get(domainScope);
    if (!current || current.coordinator.isDisposed()) {
      this.retireEntry(domainScope, entry);
      throw new Error("Device-first scope retired during registration");
    }
    return current;
  }

  private buildScopeEntry(
    store: LocalProjectionStore,
    domainScope: DomainScope,
    coordinator: DomainSyncCoordinator,
  ): DeviceFirstScopeEntry {
    const connectionStatus = createConnectionStatusNotifier(
      this.runtimeService,
    );
    const service = createReconciliationService(
      this.createReconciliationHost(
        store,
        domainScope,
        coordinator,
        connectionStatus.subscribe,
      ),
    );
    const view: LocalProjectionView = {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener) => store.subscribe(listener),
      setActiveContainer: (containerId) =>
        store.setActiveContainer(containerId),
      updateRuntime: (nextRuntime) => {
        store.updateRuntime(nextRuntime);
        connectionStatus.notify();
      },
    };
    return {
      coordinator,
      contents: {
        containerStore: store.getContainerStore(),
        reconciler: service,
        view,
      },
      disconnectReconciliationTriggers: connectReconciliationTriggers({
        service,
        store,
      }),
      removeListingAuthority: installDocumentListingAuthority({
        domainScope,
        runtimeService: this.runtimeService,
        store,
      }),
      stopDocumentPrimer: startDiscoveredDocumentPrimer(
        createDiscoveredDocumentPrimerHost({
          containerContents: this.containerContents,
          domainScope,
          runtimeService: this.runtimeService,
          store,
        }),
      ),
      unsubscribeCoordinatorDisposal: () => undefined,
      unsubscribePersistedDocumentDeletions:
        subscribeToPersistedDocumentDeletions(domainScope, (localId) => {
          store.removePersistedDocument(localId);
        }),
      unsubscribePersistedDocuments: subscribeToPersistedDocuments(
        domainScope,
        (document, change) =>
          store.refreshPersistedDocument(document, change.placementChanged),
      ),
      unsubscribePublicRuntime: connectionStatus.unsubscribeRuntime,
    };
  }

  private createReconciliationHost(
    store: LocalProjectionStore,
    domainScope: ReconciliationHost["domainScope"],
    coordinator: DomainSyncCoordinator,
    subscribeConnectionStatus: (listener: () => void) => () => void,
  ): ReconciliationHost {
    const runtimeService = this.runtimeService;
    const requestDocumentContentPull = createReconciledDocumentContentPuller({
      getContainer: (id) =>
        store.getSnapshot().containers.find((node) => node.id === id) ?? null,
      pullDocumentContent: (input) =>
        this.containerContents.pullDocumentContent(input),
      requestRegisteredDocumentRemoteSync: (localId, documentId) =>
        requestRegisteredDocumentRemoteSync(domainScope, localId, documentId),
    });
    const canDiscoverContainerDocuments = (containerId: string) => {
      const container = store
        .getSnapshot()
        .containers.find((node) => node.id === containerId);
      return container ? isRemoteBackedContainerNode(container) : false;
    };
    const listAutomaticRootCatchupContainerIds = () => {
      const homeOrgId = runtimeService.workflowInput().auth.organizationId;
      return store
        .getSnapshot()
        .containers.flatMap((node) =>
          isAutomaticRootCatchupContainerNode(node, homeOrgId) ? [node.id] : [],
        );
    };
    return {
      clock: systemReconciliationClock,
      domainScope,
      registerLane: (key, config) => coordinator.registerLane(key, config),
      canDiscoverContainerDocuments,
      getRuntimeStatus: () => {
        const { auth, infra, state } = runtimeService.workflowInput();
        return {
          dbStatus: infra.dbStatus,
          isAuthenticated: auth.isAuthenticated,
          online: state.online,
          serverEventsConnected:
            state.serverEventsConnected ??
            (state.serverEventsConnectionGeneration ?? 0) > 0,
          serverEventsPendingConnectAttempt:
            state.serverEventsPendingConnectAttempt,
        };
      },
      listKnownContainerIds: () =>
        listReconcilableContainerIds(runtimeService, store),
      listOwedDocumentDiscoveryContainerIds: (containerIds) =>
        listOwedDocumentLaneContainerIds(
          runtimeService.workflowInput().infra.execSql,
          containerIds,
        ),
      listAutomaticRootCatchupContainerIds,
      discoverContainerDocuments: (requests, onOutcome) =>
        discoverContainerDocumentLanesForRuntime({
          onOutcome,
          requests,
          runtimeService,
        }),
      loadContainerDelta: (id) => store.loadContainerDelta(id),
      applyReconciled: (delta) => store.applyReconciled(delta),
      requestDocumentContentPull,
      ...createListingCoverageHost(runtimeService, domainScope),
      ...createInitialDocumentProbeHost(runtimeService, domainScope, store),
      crawlTreeForCatchUp: () =>
        store.getContainerStore().crawlTreeForCatchUp(),
      subscribeConnectionStatus,
      refreshTree: () =>
        refreshContainerTree((onListingUnavailable) =>
          store.getContainerStore().refresh({ onListingUnavailable }),
        ),
      refreshRootTree: () =>
        refreshContainerTree((onListingUnavailable) =>
          store.getContainerStore().refreshRootLane({ onListingUnavailable }),
        ),
      isBusyError: (error) => classifyDatabaseFailure(error) === "busy",
      isIgnorableError: isDatabaseUnavailableError,
      logError: (message, error) =>
        logReconciliationFailure(this.workflowRuntime(), message, error),
    };
  }
}

async function refreshContainerTree(
  refresh: (onListingUnavailable: () => void) => Promise<boolean>,
): Promise<void> {
  let unavailable = false;
  await refresh(() => {
    unavailable = true;
  });
  if (unavailable) throw new Error("Container tree listing was unavailable");
}

function logReconciliationFailure(
  runtime: ContainerContentsStoreWorkflowRuntime,
  message: string,
  error: unknown,
): unknown {
  const { log, logError } = runtime.util;
  return logError ? logError(message, error) : log(message);
}

export { createDeviceFirstWorkflowRuntime };
