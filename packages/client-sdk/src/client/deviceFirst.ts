import type { DomainScope } from "../data/domainScope";
import {
  disposeDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
} from "../data/sync/syncCoordinator";
import {
  type ContainerContentsStoreOptions,
  isForeignSystemContainerNode,
} from "../stores/container-contents";
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
  service: ReconciliationService;
  store: LocalProjectionStore;
  view: LocalProjectionView;
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
      disposeDomainSyncCoordinator(domainScope);
    }
    this.entriesByScope.clear();
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
    // Foreign org-profile document versions already pulled this session, keyed
    // by `documentId:updatedAt`. Pulling a foreign profile opens a store that
    // stays registered and re-syncs (a forced network round-trip) on every later
    // forced sweep, so an unguarded pull is a re-sync loop that blows the sync
    // request budget. A content edit bumps the document's updatedAt server-side,
    // which re-lists it in discovery under a new version, so this pulls each
    // version exactly once — the initial body and every later change, no more.
    const pulledForeignProfileVersions = new Set<string>();
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
      listKnownContainerIds: () => {
        // User-facing containers, plus *foreign* system containers. A foreign
        // org's metadata container holds the org profile document behind
        // cross-org display names, which no mini-app opens and nothing else
        // pushes or pulls, so it must reconcile here. Own system containers are
        // excluded: their contents are authored locally and pushed by dedicated
        // agents, and sweeping a just-created one races the server round-trip.
        const homeOrganizationId =
          runtimeService.workflowInput().auth.organizationId;
        return store
          .getSnapshot()
          .containers.flatMap((node) =>
            isForeignSystemContainerNode(node, homeOrganizationId) ||
            !node.systemSlot
              ? [node.id]
              : [],
          );
      },
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
      requestDocumentContentPull: (documents, force) => {
        const homeOrganizationId =
          runtimeService.workflowInput().auth.organizationId;
        const containersById = new Map(
          store.getSnapshot().containers.map((node) => [node.id, node]),
        );
        for (const document of documents) {
          if (!document.documentId) {
            continue;
          }
          const container = document.containerId
            ? containersById.get(document.containerId)
            : undefined;
          if (
            document.containerId &&
            container &&
            isForeignSystemContainerNode(container, homeOrganizationId)
          ) {
            // A foreign org's metadata-container profile document (its display
            // name). No mini-app opens it and nothing else pulls it, so sync it
            // directly here — but only once per server version, never through
            // requestRegisteredDocumentRemoteSync: pulling opens a store that
            // then re-syncs on every forced sweep, so re-pulling an unchanged
            // profile would be a request-budget-blowing loop.
            const versionKey = `${document.documentId}:${document.updatedAt}`;
            if (!pulledForeignProfileVersions.has(versionKey)) {
              pulledForeignProfileVersions.add(versionKey);
              containerContents.pullDocumentContent({
                containerId: document.containerId,
                documentId: document.documentId,
                localId: document.id,
              });
            }
            continue;
          }
          // Non-foreign documents keep the original behavior: a forced refresh
          // re-syncs every open document's body; an unforced background pass
          // leaves open documents to their own lazy on-view sync.
          if (!force) {
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
      refreshRootTree: async () => {
        await store.getContainerStore().refreshRootLane();
      },
      isIgnorableError: isDestroyedDatabaseClientError,
    };
  }
}
