import type { DocumentSummary } from "../data/documentSummary";
import {
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
  type DocumentAttributionRangesInput,
  type DocumentAttributionRangesPage,
  loadDocumentAttributionRanges,
} from "../workflows/container-contents/documentAttributionRanges";
import { discoverContainerDocumentsFromApi } from "../workflows/container-contents/documentDiscovery";
import {
  type DocumentInfo,
  loadDocumentInfo,
} from "../workflows/container-contents/documentInfo";
import {
  purgeLocalContainerDocument,
  purgeRemoteContainerDocument,
} from "../workflows/container-contents/documentLinks";
import {
  type ContainerDocumentQueries,
  createContainerDocumentQueriesFromRuntime,
} from "../workflows/container-contents/documentQueries";
import {
  activateDocumentLink,
  addDocumentLink,
  canMutateDocumentLink,
  canMutateLocalDocumentLink,
  type DocumentStructuralMutationHost,
  moveDocumentLink,
  removeDocumentLink,
} from "../workflows/container-contents/documentStructure";
import { createContainerContentsDocumentProjectionUserKeyResolver } from "../workflows/container-contents/projectionKeys";
import {
  type ContainerContentsStoreWorkflowRuntime,
  type ContainerContentsWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
  createContainerContentsStoreWorkflowRuntime,
  createContainerContentsWorkflowRuntime,
} from "../workflows/container-contents/runtime";
import { createContainerDocumentObjectSyncState } from "../workflows/container-contents/syncState";
import type { DocumentsWorkflowRuntime } from "../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../workflows/principals/runtimePolicyWarmer";
import type {
  ContainerContents,
  ContainerDocumentLinks,
  ContainerInfoInput,
  DocumentInfoInput,
  MergeDocumentSummary,
  MoveDocumentToContainerInput,
  OpenContainerDocumentInput,
} from "./containerContentsTypes";
import {
  createOrganizationReadModelCoordinator,
  type OrganizationReadModelCoordinator,
} from "./organizationReadModels";
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
export type {
  DocumentAttributionRangesInput,
  DocumentAttributionRangesPage,
} from "../workflows/container-contents/documentAttributionRanges";
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
  PendingWriteQueueItem,
  PendingWriteQueueItemStatus,
  PendingWriteQueueObjectKind,
  PendingWriteQueueOperation,
  PendingWriteQueueOperationKind,
  PendingWriteQueueOperationStatus,
} from "../workflows/container-contents/pendingWrites";
export type {
  ContainerDocumentObjectSyncState,
  ContainerDocumentObjectSyncStatus,
} from "../workflows/container-contents/syncState";
export type {
  ContainerContents,
  ContainerDocumentLinkInput,
  ContainerDocumentLinks,
  ContainerInfoInput,
  DocumentInfoInput,
  LinkDocumentToContainerInput,
  MergeDocumentSummary,
  MoveDocumentToContainerInput,
  OpenContainerDocumentInput,
  PurgeDocumentInput,
  PurgeDocumentResult,
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
  runtime: ContainerDocumentLinks,
  mergeDocumentSummary: MergeDocumentSummary,
): DocumentStructuralMutationHost<DocumentsWorkflowRuntime> {
  return {
    documentWorkflowRuntime: runtime.documentRuntime,
    mergeDocumentSummary,
    openDocumentStore: (input) =>
      runtime.openDocument({
        containerId: input.containerId,
        documentId: input.documentId,
        localId: input.localId,
      }),
  };
}

function moveDocumentLinkNote(
  input: Pick<MoveDocumentToContainerInput, "note" | "sourceContainerId">,
): DocumentSummary {
  if (
    input.note.documentId &&
    input.sourceContainerId &&
    input.sourceContainerId !== input.note.containerId
  ) {
    return { ...input.note, containerId: input.sourceContainerId };
  }

  return input.note;
}

interface ContainerInfoOrganizationScope {
  readonly domainScope: InternalWorkflowRuntimeInput["state"]["domainScope"];
  readonly organizationId: string;
  readonly userId: string;
}

function isActiveContainerInfoOrganizationScope(
  runtime: InternalWorkflowRuntimeInput,
  scope: ContainerInfoOrganizationScope,
): boolean {
  return (
    runtime.auth.isAuthenticated &&
    runtime.auth.organizationId === scope.organizationId &&
    runtime.auth.userId === scope.userId &&
    runtime.state.domainScope === scope.domainScope
  );
}

class ContainerContentsService implements ContainerContents {
  private readonly organizationReadModels: OrganizationReadModelCoordinator;

  constructor(private readonly runtimeService: InternalRuntime) {
    this.organizationReadModels =
      createOrganizationReadModelCoordinator(runtimeService);
  }

  openTree(
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

  documentQueries(): ContainerDocumentQueries {
    return createContainerDocumentQueriesFromRuntime(this.workflowRuntime());
  }

  documentLinks(): ContainerDocumentLinks {
    const runtime = this.workflowRuntime();
    const documentRuntime = (containerId: string | null) =>
      createContainerContentsDocumentsRuntime(runtime, containerId);
    const openContainerDocument = (input: OpenContainerDocumentInput) =>
      openDocumentStore(
        runtime.state.domainScope,
        input.localId,
        documentRuntime(input.containerId),
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
      );
    const documentLinks: ContainerDocumentLinks = {
      ...runtime,
      documentRuntime,
      openDocument: openContainerDocument,
      setActiveDocumentContainer: (input) =>
        activateDocumentLink({
          host: createDocumentLinkHost(
            documentLinks,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinks,
          targetContainerId: input.targetContainerId,
        }),
      canMutateDocumentLinks: canMutateDocumentLink(runtime),
      canMutateUnsyncedDocumentLinks: canMutateLocalDocumentLink(runtime),
      linkDocumentToContainer: (input) =>
        addDocumentLink({
          host: createDocumentLinkHost(
            documentLinks,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinks,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
          targetContainerId: input.targetContainerId,
        }),
      moveDocumentToContainer: (input) =>
        moveDocumentLink({
          expandNode: input.expandNode,
          host: createDocumentLinkHost(
            documentLinks,
            input.mergeDocumentSummary,
          ),
          note: moveDocumentLinkNote(input),
          replaceLinkedContainers: input.replaceLinkedContainers,
          runtime: documentLinks,
          scheduleSync: () => this.openTree().requestSync(),
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
          targetContainerId: input.targetContainerId,
        }),
      purgeDocument: (input) => {
        // A never-synced document has no server row to delete; tear down its
        // local state only. A synced document is purged server-side first, then
        // locally.
        if (!input.note.documentId) {
          return purgeLocalContainerDocument({
            noteId: input.note.id,
            runtime: documentLinks,
          });
        }

        return purgeRemoteContainerDocument({
          documentId: input.note.documentId,
          noteId: input.note.id,
          runtime: documentLinks,
        });
      },
      resolveProjectionUserKey:
        createContainerContentsDocumentProjectionUserKeyResolver(runtime),
      unlinkDocumentFromContainer: (input) =>
        removeDocumentLink({
          host: createDocumentLinkHost(
            documentLinks,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          removedContainerId: input.removedContainerId,
          runtime: documentLinks,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
        }),
    };

    return documentLinks;
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
    const containerOrganizationId = this.openTree()
      .getSnapshot()
      .nodes.find((node) => node.id === containerId)?.organizationId;
    const warmReferencedPrincipalPolicies =
      createRuntimePrincipalPolicyWarmer(runtime);

    return discoverContainerDocumentsFromApi({
      ...createContainerDocumentDiscoveryPersistence(runtime),
      apiClient: runtime.apiClient,
      cacheReferencedPrincipalPolicies: (references) =>
        containerOrganizationId
          ? warmReferencedPrincipalPolicies({
              organizationId: containerOrganizationId,
              references,
            })
          : Promise.resolve(),
      containerId,
    });
  }

  pullDocumentContent(input: {
    containerId: string;
    localId: string;
    documentId?: string | null | undefined;
  }): void {
    const runtime = this.workflowRuntime();
    const store = openDocumentStore(
      runtime.state.domainScope,
      input.localId,
      createContainerContentsDocumentsRuntime(runtime, input.containerId),
      input.documentId ?? null,
    );
    store.requestRemoteSync();
  }

  loadContainerInfo(input: ContainerInfoInput): Promise<ContainerInfo> {
    const runtime = this.runtimeService.workflowInput();
    const organizationScope =
      runtime.auth.isAuthenticated &&
      runtime.auth.organizationId &&
      runtime.auth.userId
        ? {
            domainScope: runtime.state.domainScope,
            organizationId: runtime.auth.organizationId,
            userId: runtime.auth.userId,
          }
        : null;
    const cachedContainerProjection =
      this.openTree().getCachedContainerWriterProjection(input.containerId);
    return loadContainerInfo({
      ...input,
      apiClient: runtime.apiClient,
      containerProjection: cachedContainerProjection,
      execSql:
        runtime.infra.dbStatus === "ready" ? runtime.infra.execSql : null,
      loadOrganizationGroups: async () => {
        if (
          !organizationScope ||
          !isActiveContainerInfoOrganizationScope(
            this.runtimeService.workflowInput(),
            organizationScope,
          )
        ) {
          return [];
        }
        // Organization groups are disposable presentation data. Container
        // writer projections remain the authority for grants and access.
        const projection = await this.organizationReadModels.loadLocal(
          organizationScope.organizationId,
        );
        return isActiveContainerInfoOrganizationScope(
          this.runtimeService.workflowInput(),
          organizationScope,
        )
          ? (projection?.groups ?? [])
          : [];
      },
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

  loadDocumentEditAttribution(
    documentId: string,
  ): ReturnType<ContainerContents["loadDocumentEditAttribution"]> {
    return this.runtimeService
      .workflowInput()
      .apiClient.getDocumentEditAttribution(documentId);
  }

  loadDocumentAttributionRanges(
    input: DocumentAttributionRangesInput,
  ): Promise<DocumentAttributionRangesPage> {
    return loadDocumentAttributionRanges({
      apiClient: this.runtimeService.workflowInput().apiClient,
      query: input,
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

  workflowRuntime(): ContainerContentsStoreWorkflowRuntime {
    return createContainerContentsStoreWorkflowRuntime(
      this.runtimeService.workflowInput(),
      this.runtimeService.adoptRootContainer,
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
  // The queries object is a plain record of closures and the persistence
  // contract is a structural Pick of it; no per-method forwarding needed.
  return createContainerDocumentQueriesFromRuntime(runtime);
}
