import type { DocumentSummary } from "../data/documentSummary";
import {
  type ContainerContentsSnapshot,
  type ContainerContentsStore,
  type ContainerContentsStoreOptions,
  getOrCreateContainerContentsStore,
} from "../stores/container-contents";
import { openDocumentStore } from "../stores/documents";
import {
  type BlobInfoInput,
  type BlobInfoList,
  listBlobInfo,
} from "../workflows/container-contents/blobInfo";
import {
  type ContainerInfo,
  loadContainerInfo,
} from "../workflows/container-contents/containerInfo";
import {
  discoverAllContainerDocuments,
  discoverContainerDocumentsFromApi,
  hasUndiscoveredDocumentUpdateEvent,
  refreshAllContainerDocumentsFromApi,
} from "../workflows/container-contents/documentDiscovery";
import {
  type DocumentInfo,
  loadDocumentInfo,
} from "../workflows/container-contents/documentInfo";
import {
  type ContainerDocumentQueries,
  createContainerDocumentQueriesFromRuntime,
} from "../workflows/container-contents/documentQueries";
import {
  activateDocumentLinkState,
  canMutateDocumentLink,
  canMutateLocalDocumentLink,
  type DocumentStructuralMutationHost,
  linkDocumentLinkState,
  moveDocumentLinkState,
  unlinkDocumentLinkState,
} from "../workflows/container-contents/documentStructure";
import { createContainerContentsDocumentProjectionUserKeyResolver } from "../workflows/container-contents/projectionKeys";
import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
  createContainerContentsWorkflowRuntime,
} from "../workflows/container-contents/runtime";
import { createContainerDocumentObjectSyncState } from "../workflows/container-contents/syncState";
import type { DocumentsWorkflowRuntime } from "../workflows/documents";
import type {
  ContainerContents,
  ContainerDocumentLinkActions,
  ContainerInfoInput,
  DocumentInfoInput,
  MergeDocumentSummary,
  OpenContainerDocumentStoreInput,
} from "./containerContentsTypes";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

export type {
  ContainerContentsContextValue,
  ContainerContentsStore,
  ContainerContentsStoreOptions,
  ContainerNode,
} from "../stores/container-contents";
export type {
  BlobInfo,
  BlobInfoAttachmentKind,
  BlobInfoDocumentReference,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortDirection,
  BlobInfoSortKey,
} from "../workflows/container-contents/blobInfo";
export type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "../workflows/container-contents/containerInfo";
export type { DocumentInfo } from "../workflows/container-contents/documentInfo";
export type {
  ContainerDocumentQueries,
  ContainerDocumentSidebarRow,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
} from "../workflows/container-contents/documentQueries";
export type { SetLinkedContainerIdsForDocument } from "../workflows/container-contents/documentStructure";
export type {
  ContainerDocumentObjectSyncState,
  ContainerDocumentObjectSyncStatus,
} from "../workflows/container-contents/syncState";
export type {
  ContainerContents,
  ContainerDocumentLinkActions,
  ContainerDocumentLinkInput,
  ContainerInfoInput,
  DocumentInfoInput,
  LinkDocumentToContainerInput,
  MergeDocumentSummary,
  MoveDocumentToContainerInput,
  OpenContainerDocumentStoreInput,
  SetActiveDocumentContainerInput,
  UnlinkDocumentFromContainerInput,
} from "./containerContentsTypes";

type ContainerDocumentDiscoveryPersistence = Pick<
  ContainerDocumentQueries,
  | "applyContainerDocumentTombstones"
  | "loadContainerDocumentWatermark"
  | "replaceDocumentLinksBatch"
  | "saveContainerDocumentWatermark"
  | "upsertDiscoveredDocuments"
>;

export { createContainerDocumentObjectSyncState };

export function createContainerContents(
  runtime: InternalRuntime,
): ContainerContents {
  return new ContainerContentsService(runtime);
}

function createDocumentLinkHost(
  runtime: ContainerDocumentLinkActions,
  mergeDocumentSummary: MergeDocumentSummary,
): DocumentStructuralMutationHost<DocumentsWorkflowRuntime> {
  return {
    documentWorkflowRuntime: runtime.documentWorkflowRuntime,
    mergeDocumentSummary,
    openDocumentStore: (input) =>
      runtime.openDocumentStore({
        containerId: input.containerId,
        documentId: input.documentId,
        localId: input.localId,
      }),
  };
}

type DocumentRefreshContainerSnapshot = Pick<
  ContainerContentsSnapshot,
  "ready"
> & {
  nodes?: ContainerContentsSnapshot["nodes"] | null;
};

export function listUserContainerIdsForDocumentRefresh(
  snapshot: DocumentRefreshContainerSnapshot,
): string[] | null {
  if (!snapshot.ready) {
    return null;
  }

  return (snapshot.nodes ?? []).flatMap((node) =>
    node.systemSlot ? [] : [node.id],
  );
}

class ContainerContentsService implements ContainerContents {
  constructor(private readonly runtimeService: InternalRuntime) {}

  openStore(
    options?: ContainerContentsStoreOptions | undefined,
  ): ContainerContentsStore {
    const runtime = this.workflowRuntime();
    const store = getOrCreateContainerContentsStore(
      runtime.state.domainScope,
      runtime,
      options,
    );
    return store;
  }

  localQueries(): ContainerDocumentQueries {
    return createContainerDocumentQueriesFromRuntime(this.workflowRuntime());
  }

  documentLinkActions(): ContainerDocumentLinkActions {
    const runtime = this.workflowRuntime();
    const documentWorkflowRuntime = (containerId: string) =>
      createContainerContentsDocumentsRuntime(runtime, containerId);
    const openContainerDocumentStore = (
      input: OpenContainerDocumentStoreInput,
    ) =>
      openDocumentStore(
        runtime.state.domainScope,
        input.localId,
        documentWorkflowRuntime(input.containerId),
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
      );
    const documentLinkActions: ContainerDocumentLinkActions = {
      ...runtime,
      documentWorkflowRuntime,
      openDocumentStore: openContainerDocumentStore,
      setActiveDocumentContainer: (input) =>
        activateDocumentLinkState({
          host: createDocumentLinkHost(
            documentLinkActions,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinkActions,
          targetContainerId: input.targetContainerId,
        }),
      canMutateDocumentLinks: canMutateDocumentLink(runtime),
      canMutateLocalDocumentLinks: canMutateLocalDocumentLink(runtime),
      linkDocumentToContainer: (input) =>
        linkDocumentLinkState({
          host: createDocumentLinkHost(
            documentLinkActions,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinkActions,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
          targetContainerId: input.targetContainerId,
        }),
      moveDocumentToContainer: (input) =>
        moveDocumentLinkState({
          expandNode: input.expandNode,
          host: createDocumentLinkHost(
            documentLinkActions,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinkActions,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
          targetContainerId: input.targetContainerId,
        }),
      resolveProjectionUserKey:
        createContainerContentsDocumentProjectionUserKeyResolver(runtime),
      unlinkDocumentFromContainer: (input) =>
        unlinkDocumentLinkState({
          host: createDocumentLinkHost(
            documentLinkActions,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          removedContainerId: input.removedContainerId,
          runtime: documentLinkActions,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
        }),
    };

    return documentLinkActions;
  }

  discoverContainerDocuments(
    containerId: string,
  ): Promise<ReadonlyArray<DocumentSummary> | null> {
    const runtime = createContainerContentsDiscoveryRuntime(
      this.runtimeService.workflowInput(),
    );
    if (!runtime) {
      return Promise.resolve(null);
    }

    return discoverContainerDocumentsFromApi({
      ...createContainerDocumentDiscoveryPersistence(runtime),
      apiClient: runtime.apiClient,
      cacheReferencedPrincipalPolicies:
        runtime.util.cacheReferencedPrincipalPolicies,
      containerId,
    });
  }

  hasUnseenDocumentUpdates(knownDocumentIds: ReadonlySet<string>): boolean {
    const allKnownDocumentIds = new Set(knownDocumentIds);
    const snapshot = this.openStore().getSnapshot();
    for (const node of snapshot.nodes ?? []) {
      if (node.metadataDocumentId) {
        allKnownDocumentIds.add(node.metadataDocumentId);
      }
    }

    return hasUndiscoveredDocumentUpdateEvent(
      this.runtimeService.workflowInput().state.events,
      allKnownDocumentIds,
    );
  }

  loadContainerInfo(input: ContainerInfoInput): Promise<ContainerInfo> {
    const runtime = this.runtimeService.workflowInput();
    const cachedContainerProjection =
      this.openStore().getCachedContainerWriterProjection(input.containerId);
    return loadContainerInfo({
      ...input,
      apiClient: runtime.apiClient,
      containerProjection: cachedContainerProjection,
      execSql:
        runtime.infra.dbStatus === "ready" ? runtime.infra.execSql : null,
      organizationId: runtime.auth.organizationId,
      parentId: input.parentId ?? null,
    });
  }

  loadDocumentInfo(input: DocumentInfoInput): Promise<DocumentInfo> {
    const runtime = this.runtimeService.workflowInput();
    return loadDocumentInfo({
      ...input,
      apiClient: runtime.apiClient,
      execSql:
        runtime.infra.dbStatus === "ready" ? runtime.infra.execSql : null,
    });
  }

  listBlobInfo(input: BlobInfoInput = {}): Promise<BlobInfoList> {
    const runtime = this.runtimeService.workflowInput();
    return listBlobInfo({
      ...input,
      execSql:
        runtime.infra.dbStatus === "ready" ? runtime.infra.execSql : null,
    });
  }

  refreshAllContainerDocuments(): Promise<ReadonlyArray<DocumentSummary> | null> {
    const runtime = createContainerContentsDiscoveryRuntime(
      this.runtimeService.workflowInput(),
    );
    if (!runtime) {
      return Promise.resolve(null);
    }

    const snapshot = this.openStore().getSnapshot();
    const snapshotContainerIds =
      listUserContainerIdsForDocumentRefresh(snapshot);
    if (snapshotContainerIds) {
      if (
        snapshotContainerIds.length === 0 &&
        (snapshot.nodes ?? []).length > 0
      ) {
        return Promise.resolve([]);
      }
      if (snapshotContainerIds.length === 0) {
        return refreshAllContainerDocumentsFromApi({
          ...createContainerDocumentDiscoveryPersistence(runtime),
          apiClient: runtime.apiClient,
          cacheReferencedPrincipalPolicies:
            runtime.util.cacheReferencedPrincipalPolicies,
        });
      }
      return discoverAllContainerDocuments({
        ...createContainerDocumentDiscoveryPersistence(runtime),
        cacheReferencedPrincipalPolicies:
          runtime.util.cacheReferencedPrincipalPolicies,
        containerIds: snapshotContainerIds,
        listContainerDocuments: (containerId, options) =>
          runtime.apiClient.listContainerDocuments(containerId, options),
      });
    }

    return refreshAllContainerDocumentsFromApi({
      ...createContainerDocumentDiscoveryPersistence(runtime),
      apiClient: runtime.apiClient,
      cacheReferencedPrincipalPolicies:
        runtime.util.cacheReferencedPrincipalPolicies,
    });
  }

  workflowRuntime(): ContainerContentsWorkflowRuntime {
    return createContainerContentsWorkflowRuntime(
      this.runtimeService.workflowInput(),
    );
  }
}

function createContainerContentsDiscoveryRuntime(
  input: InternalWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntime | null {
  if (input.infra.dbStatus !== "ready") {
    return null;
  }

  return createContainerContentsWorkflowRuntime(input);
}

function createContainerDocumentDiscoveryPersistence(
  runtime: ContainerContentsWorkflowRuntime,
): ContainerDocumentDiscoveryPersistence {
  const queries = createContainerDocumentQueriesFromRuntime(runtime);

  return {
    applyContainerDocumentTombstones: (tombstones) =>
      queries.applyContainerDocumentTombstones(tombstones),
    loadContainerDocumentWatermark: (containerId) =>
      queries.loadContainerDocumentWatermark(containerId),
    replaceDocumentLinksBatch: (inputs) =>
      queries.replaceDocumentLinksBatch(inputs),
    saveContainerDocumentWatermark: (containerId, watermark) =>
      queries.saveContainerDocumentWatermark(containerId, watermark),
    upsertDiscoveredDocuments: (inputs) =>
      queries.upsertDiscoveredDocuments(inputs),
  };
}
