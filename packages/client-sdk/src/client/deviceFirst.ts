import { isDestroyedDatabaseClientError } from "../data/sync/syncCoordinator";
import type { ContainerContentsStoreOptions } from "../stores/container-contents";
import { requestRegisteredDocumentRemoteSync } from "../stores/documents/registry";
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
import { loadLocalContainerProjectionDocumentsFromRuntime } from "../workflows/container-contents/projectionView";
import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsWorkflowRuntime,
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
}

export function createDeviceFirst(
  runtimeService: InternalRuntime,
  containerContents: ContainerContents,
): DeviceFirst {
  return new DeviceFirstService(runtimeService, containerContents);
}

interface DeviceFirstScopeEntry {
  service: ReconciliationService;
  store: LocalProjectionStore;
  view: LocalProjectionView;
}

class DeviceFirstService implements DeviceFirst {
  private readonly entriesByScope = new WeakMap<
    object,
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

  private workflowRuntime(): ContainerContentsWorkflowRuntime {
    return createContainerContentsWorkflowRuntime(
      this.runtimeService.workflowInput(),
    );
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
    connectReconciliationTriggers({ service, store });
    service.start();

    const view: LocalProjectionView = {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener) => store.subscribe(listener),
      setActiveContainer: (containerId) =>
        store.setActiveContainer(containerId),
      updateRuntime: (nextRuntime) => store.updateRuntime(nextRuntime),
    };

    const entry: DeviceFirstScopeEntry = { service, store, view };
    this.entriesByScope.set(domainScope, entry);
    return entry;
  }

  private createReconciliationHost(
    store: LocalProjectionStore,
    domainScope: ReconciliationHost["domainScope"],
  ): ReconciliationHost {
    const runtimeService = this.runtimeService;
    const containerContents = this.containerContents;
    return {
      domainScope,
      getRuntimeStatus: () => {
        const input = runtimeService.workflowInput();
        return {
          dbStatus: input.infra.dbStatus,
          isAuthenticated: input.auth.isAuthenticated,
          online: input.state.online,
        };
      },
      listKnownContainerIds: () =>
        store
          .getSnapshot()
          .containers.flatMap((node) => (node.systemSlot ? [] : [node.id])),
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
      requestDocumentContentPull: (documents) => {
        for (const document of documents) {
          if (!document.documentId) {
            continue;
          }
          requestRegisteredDocumentRemoteSync(
            domainScope,
            document.id,
            document.documentId,
          );
        }
      },
      refreshTree: async () => {
        await store.getContainerStore().refresh();
      },
      isIgnorableError: isDestroyedDatabaseClientError,
    };
  }
}
