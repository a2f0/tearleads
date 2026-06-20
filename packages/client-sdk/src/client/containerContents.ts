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
  type ContainerContentsWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
  createContainerContentsWorkflowRuntime,
} from "../workflows/container-contents/runtime";
import { createContainerDocumentObjectSyncState } from "../workflows/container-contents/syncState";
import type { DocumentsWorkflowRuntime } from "../workflows/documents";
import type {
  ContainerContents,
  ContainerDocumentLinks,
  ContainerInfoInput,
  DocumentInfoInput,
  MergeDocumentSummary,
  MoveDocumentToContainerInput,
  OpenContainerDocumentInput,
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

class ContainerContentsService implements ContainerContents {
  constructor(private readonly runtimeService: InternalRuntime) {}

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
    const documentRuntime = (containerId: string) =>
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

    return discoverContainerDocumentsFromApi({
      ...createContainerDocumentDiscoveryPersistence(runtime),
      apiClient: runtime.apiClient,
      cacheReferencedPrincipalPolicies:
        runtime.util.cacheReferencedPrincipalPolicies,
      containerId,
    });
  }

  loadContainerInfo(input: ContainerInfoInput): Promise<ContainerInfo> {
    const runtime = this.runtimeService.workflowInput();
    const cachedContainerProjection =
      this.openTree().getCachedContainerWriterProjection(input.containerId);
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
