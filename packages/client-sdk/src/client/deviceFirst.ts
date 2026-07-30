import type { DomainScope } from "../data/domainScope";
import {
  disposeDomainSyncCoordinator,
  isDatabaseUnavailableError,
} from "../data/sync/syncCoordinator";
import {
  type ContainerContentsStoreOptions,
  isAutomaticRootCatchupContainerNode,
  isReconcilableContainerNode,
  isRemoteBackedContainerNode,
} from "../stores/container-contents";
import { openDocumentStore } from "../stores/documents";
import {
  requestRegisteredDocumentRemoteSync,
  subscribeToPersistedDocumentDeletions,
} from "../stores/documents/registry";
import {
  getOrCreateLocalProjectionStore,
  type LocalProjectionReconciledDelta,
  type LocalProjectionStore,
  type LocalProjectionView,
} from "../stores/local-projection";
import {
  connectReconciliationTriggers,
  createReconciliationService,
  type ReconciliationHost,
  type ReconciliationService,
} from "../sync/reconciliation";
import { createReconciledDocumentContentPuller } from "../sync/reconciliation/documentContentPull";
import { listAllContainerDocumentIdsFromApi } from "../workflows/container-contents/containerDocumentListing";
import { probeUndiscoveredRemoteDocumentBatch } from "../workflows/container-contents/documentHydrationProbe";
import { loadLocalContainerProjectionDocumentsFromRuntime } from "../workflows/container-contents/projectionView";
import {
  type ContainerContentsStoreWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
  createContainerContentsStoreWorkflowRuntime,
} from "../workflows/container-contents/runtime";
import type { ContainerContents } from "./containerContents";
import type { InternalRuntime } from "./workflowRuntime";

export type { LocalProjectionView } from "../stores/local-projection";

/**
 * Device-first facade. Bundles the synchronous local projection (Layer A) with
 * the background reconciler (Layer B) so the app can render from the local
 * SQLite/OPFS cache immediately and let remote reconciliation patch the view.
 */
export interface DeviceFirst {
  /** Open the device-first container/document view for the current scope. */
  openView(
    options?: ContainerContentsStoreOptions | undefined,
  ): LocalProjectionView;
  /** Handle to the background reconciliation service for the current scope. */
  reconciler(): ReconciliationService;
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
  disconnectReconciliationTriggers: () => void;
  service: ReconciliationService;
  store: LocalProjectionStore;
  unsubscribePersistedDocumentDeletions: () => void;
  view: LocalProjectionView;
}

function createInitialDocumentProbeHost(
  runtimeService: InternalRuntime,
  domainScope: ReconciliationHost["domainScope"],
): Pick<
  ReconciliationHost,
  | "listContainerDocumentIds"
  | "probeUndiscoveredDocumentsBatch"
  | "reportInitialDocumentProbeComplete"
> {
  return {
    listContainerDocumentIds: (containerId) => {
      const runtime = createDeviceFirstWorkflowRuntime(runtimeService);
      return listAllContainerDocumentIdsFromApi({
        apiClient: runtime.apiClient,
        containerId,
        reportErrors: false,
      });
    },
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

  openView(
    options?: ContainerContentsStoreOptions | undefined,
  ): LocalProjectionView {
    return this.getOrCreateEntry(options).view;
  }

  reconciler(): ReconciliationService {
    return this.getOrCreateEntry().service;
  }

  dispose(): void {
    // Stop every reconciler created this session — not just the current
    // scope's. A scope change (e.g. anonymous -> authenticated) leaves the old
    // scope's reconciler subscribed and its coordinator pump live; tear them
    // all down. Force-stop each scope's coordinator (which runs the reconciler
    // lane) alongside stopping the service.
    for (const [domainScope, entry] of this.entriesByScope) {
      entry.service.stop();
      entry.disconnectReconciliationTriggers();
      entry.unsubscribePersistedDocumentDeletions();
      disposeDomainSyncCoordinator(domainScope);
    }
    this.entriesByScope.clear();
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
    if (existing) {
      // Do not call updateRuntime here: openView()/reconciler() run during
      // React render, and updateRuntime emits synchronously. Hosts drive runtime
      // updates through view.updateRuntime() from an effect instead.
      return existing;
    }

    const store = getOrCreateLocalProjectionStore({
      domainScope,
      runtime,
      options,
    });
    const service = createReconciliationService(
      this.createReconciliationHost(store, domainScope),
    );
    const disconnectReconciliationTriggers = connectReconciliationTriggers({
      service,
      store,
    });
    const unsubscribePersistedDocumentDeletions =
      subscribeToPersistedDocumentDeletions(domainScope, (localId) => {
        store.removePersistedDocument(localId);
      });
    service.start();

    const view: LocalProjectionView = {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener) => store.subscribe(listener),
      setActiveContainer: (containerId) =>
        store.setActiveContainer(containerId),
      updateRuntime: (nextRuntime) => store.updateRuntime(nextRuntime),
    };

    const entry: DeviceFirstScopeEntry = {
      disconnectReconciliationTriggers,
      service,
      store,
      unsubscribePersistedDocumentDeletions,
      view,
    };
    this.entriesByScope.set(domainScope, entry);
    return entry;
  }

  private createReconciliationHost(
    store: LocalProjectionStore,
    domainScope: ReconciliationHost["domainScope"],
  ): ReconciliationHost {
    const runtimeService = this.runtimeService;
    const containerContents = this.containerContents;
    const requestDocumentContentPull = createReconciledDocumentContentPuller({
      getContainer: (containerId) =>
        store
          .getSnapshot()
          .containers.find((container) => container.id === containerId) ?? null,
      pullDocumentContent: (input) =>
        containerContents.pullDocumentContent(input),
      requestRegisteredDocumentRemoteSync: (localId, documentId) =>
        requestRegisteredDocumentRemoteSync(domainScope, localId, documentId),
    });
    const canDiscoverContainerDocuments = (containerId: string) => {
      const container = store
        .getSnapshot()
        .containers.find((node) => node.id === containerId);
      return container ? isRemoteBackedContainerNode(container) : false;
    };
    const listKnownContainerIds = () => {
      // A local-first id is not listable yet and may still be racing its create
      // request. Once remote-backed, it participates normally; system contents
      // are especially important during rematerialization because this device
      // may not have authored them.
      const homeOrganizationId =
        runtimeService.workflowInput().auth.organizationId;
      return store
        .getSnapshot()
        .containers.flatMap((node) =>
          isReconcilableContainerNode(node, homeOrganizationId)
            ? [node.id]
            : [],
        );
    };
    const listAutomaticRootCatchupContainerIds = () => {
      const homeOrganizationId =
        runtimeService.workflowInput().auth.organizationId;
      return store
        .getSnapshot()
        .containers.flatMap((node) =>
          isAutomaticRootCatchupContainerNode(node, homeOrganizationId)
            ? [node.id]
            : [],
        );
    };
    return {
      domainScope,
      canDiscoverContainerDocuments,
      getRuntimeStatus: () => {
        const input = runtimeService.workflowInput();
        return {
          dbStatus: input.infra.dbStatus,
          isAuthenticated: input.auth.isAuthenticated,
          online: input.state.online,
        };
      },
      listKnownContainerIds,
      // Root discovery can surface directly granted non-root containers, so
      // retain every regular container. Exclude only this identity's own system
      // children; cold/auth backfill and explicit full Refresh cover those.
      listAutomaticRootCatchupContainerIds,
      discoverContainerDocuments: (containerId) =>
        containerContents.discoverContainerDocuments(containerId),
      loadContainerDelta: async (
        containerId,
      ): Promise<LocalProjectionReconciledDelta> => {
        const documents =
          await loadLocalContainerProjectionDocumentsFromRuntime({
            containerIds: [containerId],
            runtime: this.workflowRuntime(),
          });
        return {
          containerId,
          documentSummaries: documents.documentSummaries,
          linkedContainerIdsByDocumentId:
            documents.linkedContainerIdsByDocumentId,
        };
      },
      applyReconciled: (delta) => store.applyReconciled(delta),
      requestDocumentContentPull,
      ...createInitialDocumentProbeHost(runtimeService, domainScope),
      refreshTree: async () => {
        await store.getContainerStore().refresh();
      },
      refreshRootTree: async () => {
        await store.getContainerStore().refreshRootLane();
      },
      isIgnorableError: isDatabaseUnavailableError,
    };
  }
}

export function createDeviceFirstWorkflowRuntime(
  runtimeService: InternalRuntime,
): ContainerContentsStoreWorkflowRuntime {
  return createContainerContentsStoreWorkflowRuntime(
    runtimeService.workflowInput(),
    runtimeService.adoptRootContainer,
  );
}
