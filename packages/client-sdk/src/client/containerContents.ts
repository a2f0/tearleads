import type { DocumentSummary } from "../data/documentSummary";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import {
  type ContainerContentsStore,
  type ContainerContentsStoreOptions,
  getOrCreateContainerContentsStore,
} from "../stores/container-contents";
import { type DocumentStore, primeDocumentStore } from "../stores/documents";
import {
  type ContainerInfo,
  type ContainerInfoRemoteMode,
  loadContainerInfo,
} from "../workflows/container-contents/containerInfo";
import {
  discoverContainerDocumentsFromApi,
  hasUndiscoveredDocumentUpdateEvent,
  refreshAllContainerDocumentsFromApi,
} from "../workflows/container-contents/documentDiscovery";
import {
  type DocumentInfo,
  type DocumentInfoRemoteMode,
  loadDocumentInfo,
} from "../workflows/container-contents/documentInfo";
import {
  type ContainerDocumentReadModel,
  createContainerDocumentReadModelFromRuntime,
} from "../workflows/container-contents/documentReadModel";
import {
  activateDocumentLinkState,
  canMutateDocumentLink,
  type DocumentStructuralMutationHost,
  linkDocumentLinkState,
  moveDocumentLinkState,
  type SetLinkedContainerIdsForDocument,
  unlinkDocumentLinkState,
} from "../workflows/container-contents/documentStructure";
import {
  type ContainerContentsProjectionUserKeyResolver,
  createContainerContentsDocumentProjectionUserKeyResolver,
} from "../workflows/container-contents/projectionKeys";
import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
  createContainerContentsWorkflowRuntime,
} from "../workflows/container-contents/runtime";
import { createContainerDocumentObjectSyncState } from "../workflows/container-contents/syncState";
import type { DocumentsWorkflowRuntime } from "../workflows/documents";
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
  ContainerInfo,
  ContainerShareAccessLevel,
} from "../workflows/container-contents/containerInfo";
export type { DocumentInfo } from "../workflows/container-contents/documentInfo";
export type {
  ContainerDocumentReadModel,
  ContainerDocumentSidebarRow,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
} from "../workflows/container-contents/documentReadModel";
export type { SetLinkedContainerIdsForDocument } from "../workflows/container-contents/documentStructure";
export type {
  ContainerDocumentObjectSyncState,
  ContainerDocumentObjectSyncStatus,
} from "../workflows/container-contents/syncState";

type ContainerDocumentDiscoveryPersistence = Pick<
  ContainerDocumentReadModel,
  | "applyContainerDocumentTombstones"
  | "loadContainerDocumentWatermark"
  | "replaceDocumentLinksBatch"
  | "saveContainerDocumentWatermark"
  | "upsertDiscoveredDocuments"
>;

/**
 * Selects the container to inspect.
 *
 * Container info combines local SQLite timestamps with optional remote writer
 * projection details. Remote details include direct and inherited grants,
 * organization groups, security-path metadata, and sync watermarks for the
 * parent, child-container, and document lanes.
 *
 * Fields:
 * - `containerId`: Container id to inspect.
 * - `parentId`: Known parent id used when the container has not been synced
 *   locally yet. Synced local state wins when available.
 * - `remoteInfoMode`: Controls whether remote projection details are fetched.
 */
export interface ContainerInfoInput {
  containerId: string;
  parentId?: string | null | undefined;
  remoteInfoMode?: ContainerInfoRemoteMode | undefined;
}

/**
 * Selects the document to inspect.
 *
 * Document info combines local document state, local and pending attachment
 * rows, and optional remote writer projection details.
 *
 * Fields:
 * - `localId`: Local document id stored in the client database.
 * - `remoteInfoMode`: Controls whether remote projection details are fetched.
 */
export interface DocumentInfoInput {
  localId: string;
  remoteInfoMode?: DocumentInfoRemoteMode | undefined;
}

export { createContainerDocumentObjectSyncState };

export type MergeDocumentSummary = (nextDocument: DocumentSummary) => void;

export interface PrimeContainerDocumentStoreInput {
  readonly containerId: string;
  readonly documentId?: string | null | undefined;
  readonly initialDocumentKind?: StoredDocumentKind | undefined;
  readonly initialText?: string | undefined;
  readonly localId: string;
}

export interface ContainerDocumentLinkInput {
  readonly mergeDocumentSummary: MergeDocumentSummary;
  readonly note: DocumentSummary;
}

export interface MoveContainerDocumentLinkInput
  extends ContainerDocumentLinkInput {
  readonly expandNode: (nodeId: string) => void;
  readonly setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  readonly targetContainerId: string;
}

export interface LinkContainerDocumentLinkInput
  extends ContainerDocumentLinkInput {
  readonly setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  readonly targetContainerId: string;
}

export interface UnlinkContainerDocumentLinkInput
  extends ContainerDocumentLinkInput {
  readonly removedContainerId: string;
  readonly setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}

export interface ActivateContainerDocumentLinkInput
  extends ContainerDocumentLinkInput {
  readonly targetContainerId: string;
}

export interface ContainerDocumentLinksRuntime
  extends ContainerContentsWorkflowRuntime {
  readonly dbStatus: ContainerContentsWorkflowRuntime["dbStatus"];
  readonly isAuthenticated: ContainerContentsWorkflowRuntime["isAuthenticated"];
  readonly online: ContainerContentsWorkflowRuntime["online"];
  activateDocumentContainer(
    input: ActivateContainerDocumentLinkInput,
  ): Promise<DocumentSummary | null>;
  readonly canMutateDocumentLinks: boolean;
  createDocumentRuntime(containerId: string): DocumentsWorkflowRuntime;
  linkDocumentToContainer(
    input: LinkContainerDocumentLinkInput,
  ): Promise<DocumentSummary | null>;
  moveDocumentToContainer(
    input: MoveContainerDocumentLinkInput,
  ): Promise<{ linksChanged: boolean; note: DocumentSummary | null }>;
  primeDocumentStore(input: PrimeContainerDocumentStoreInput): DocumentStore;
  readonly resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  unlinkDocumentFromContainer(
    input: UnlinkContainerDocumentLinkInput,
  ): Promise<DocumentSummary | null>;
}

/**
 * High-level container-content service for document discovery and diagnostics.
 *
 * The facade owns the normal SDK protocol: it supplies the API client,
 * referenced-principal policy cache, local document read model, link
 * projection, tombstone handling, and sync watermarks. Consumers that need a
 * custom persistence protocol can call the lower-level workflows directly from
 * `@tearleads/client-sdk`.
 */
export interface ContainerContents {
  /**
   * Get the default container contents store for the current SDK runtime.
   *
   * The store is cached per domain scope and created from the current runtime
   * snapshot. Long-lived hosts should call `updateRuntime` after runtime
   * changes, such as from a React effect.
   */
  store(
    options?: ContainerContentsStoreOptions | undefined,
  ): ContainerContentsStore;

  /**
   * Create the default local document read model for container contents.
   *
   * The model is bound to the current SDK runtime snapshot, including the
   * active SQLite executor. Recreate it when the SDK runtime version changes.
   */
  documentReadModel(): ContainerDocumentReadModel;

  /**
   * Create the default runtime bundle for advanced document-link workflows.
   *
   * The returned object includes the current container-contents runtime,
   * the document projection-key resolver, mutation readiness, document store
   * priming, and container document-link mutations. Product stores can pass
   * this bundle around without rebuilding SDK runtime plumbing themselves.
   */
  documentLinksRuntime(): ContainerDocumentLinksRuntime;

  /**
   * Discover remote documents linked to one container.
   *
   * The method pages the remote container-document lane, writes discovered
   * document summaries into local SQLite, replaces the local link projection for
   * each discovered document, applies applicable tombstones, caches referenced
   * principal policies needed by newly visible documents, and advances the
   * container-document watermark after the local apply completes.
   *
   * Returns the document summaries touched by the apply, or `null` when the
   * local database is unavailable or the remote lane could not be fully listed.
   *
   * Parameters:
   * - `containerId`: Remote container id whose document lane should be listed.
   */
  discoverDocuments(
    containerId: string,
  ): Promise<ReadonlyArray<DocumentSummary> | null>;

  /**
   * Check whether the current event snapshot includes document updates that
   * are not yet represented by the supplied known remote document ids.
   */
  hasUndiscoveredDocumentUpdates(
    knownDocumentIds: ReadonlySet<string>,
  ): boolean;

  /**
   * Load diagnostic information for one local document.
   *
   * Local details are available when SQLite is ready. Remote details are loaded
   * from the document writer projection according to `remoteInfoMode`; the
   * default is `"always"`.
   */
  loadDocumentInfo(input: DocumentInfoInput): Promise<DocumentInfo>;

  /**
   * Load diagnostic information for one container.
   *
   * Local details include synced timestamps. Remote details are loaded from the
   * container writer projection according to `remoteInfoMode`; the default is
   * `"always"`. Pass `parentId` when inspecting a container before its local row
   * has been synced.
   */
  loadInfo(input: ContainerInfoInput): Promise<ContainerInfo>;

  /**
   * Refresh document discovery for every remotely visible container.
   *
   * The method discovers the remote container tree first, then applies each
   * container-document lane through the same local persistence protocol as
   * `discoverDocuments`.
   *
   * Returns all document summaries touched by the refresh, or `null` when the
   * local database is unavailable, or when the remote container tree or a
   * document lane could not be fully listed.
   */
  refreshDocuments(): Promise<ReadonlyArray<DocumentSummary> | null>;

  /**
   * Create a workflow runtime for advanced container-content workflows.
   *
   * Prefer the high-level methods on this service for the default SDK protocol.
   * Use this when constructing lower-level stores or custom workflows that need
   * access to the current runtime snapshot.
   */
  runtime(): ContainerContentsWorkflowRuntime;
}

export function createContainerContents(
  runtime: InternalRuntime,
): ContainerContents {
  return new ContainerContentsService(runtime);
}

function createDocumentLinkHost(
  runtime: ContainerDocumentLinksRuntime,
  mergeDocumentSummary: MergeDocumentSummary,
): DocumentStructuralMutationHost<DocumentsWorkflowRuntime> {
  return {
    createDocumentRuntime: runtime.createDocumentRuntime,
    mergeDocumentSummary,
    primeDocumentStore: (input) =>
      runtime.primeDocumentStore({
        containerId: input.containerId,
        documentId: input.documentId,
        localId: input.localId,
      }),
  };
}

class ContainerContentsService implements ContainerContents {
  constructor(private readonly runtimeService: InternalRuntime) {}

  store(
    options?: ContainerContentsStoreOptions | undefined,
  ): ContainerContentsStore {
    const runtime = this.runtime();
    const store = getOrCreateContainerContentsStore(
      runtime.domainScope,
      runtime,
      options,
    );
    return store;
  }

  documentReadModel(): ContainerDocumentReadModel {
    return createContainerDocumentReadModelFromRuntime(this.runtime());
  }

  documentLinksRuntime(): ContainerDocumentLinksRuntime {
    const runtime = this.runtime();
    const createDocumentRuntime = (containerId: string) =>
      createContainerContentsDocumentsRuntime(runtime, containerId);
    const primeContainerDocumentStore = (
      input: PrimeContainerDocumentStoreInput,
    ) =>
      primeDocumentStore(
        runtime.domainScope,
        input.localId,
        createDocumentRuntime(input.containerId),
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
      );
    const documentLinksRuntime: ContainerDocumentLinksRuntime = {
      ...runtime,
      activateDocumentContainer: (input) =>
        activateDocumentLinkState({
          host: createDocumentLinkHost(
            documentLinksRuntime,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinksRuntime,
          targetContainerId: input.targetContainerId,
        }),
      canMutateDocumentLinks: canMutateDocumentLink(runtime),
      createDocumentRuntime,
      linkDocumentToContainer: (input) =>
        linkDocumentLinkState({
          host: createDocumentLinkHost(
            documentLinksRuntime,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinksRuntime,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
          targetContainerId: input.targetContainerId,
        }),
      moveDocumentToContainer: (input) =>
        moveDocumentLinkState({
          expandNode: input.expandNode,
          host: createDocumentLinkHost(
            documentLinksRuntime,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          runtime: documentLinksRuntime,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
          targetContainerId: input.targetContainerId,
        }),
      primeDocumentStore: primeContainerDocumentStore,
      resolveProjectionUserKey:
        createContainerContentsDocumentProjectionUserKeyResolver(runtime),
      unlinkDocumentFromContainer: (input) =>
        unlinkDocumentLinkState({
          host: createDocumentLinkHost(
            documentLinksRuntime,
            input.mergeDocumentSummary,
          ),
          note: input.note,
          removedContainerId: input.removedContainerId,
          runtime: documentLinksRuntime,
          setLinkedContainerIdsForDocument:
            input.setLinkedContainerIdsForDocument,
        }),
    };

    return documentLinksRuntime;
  }

  discoverDocuments(
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
        runtime.cacheReferencedPrincipalPolicies,
      containerId,
    });
  }

  hasUndiscoveredDocumentUpdates(
    knownDocumentIds: ReadonlySet<string>,
  ): boolean {
    return hasUndiscoveredDocumentUpdateEvent(
      this.runtimeService.workflowInput().events,
      knownDocumentIds,
    );
  }

  loadInfo(input: ContainerInfoInput): Promise<ContainerInfo> {
    const runtime = this.runtimeService.workflowInput();
    return loadContainerInfo({
      ...input,
      apiClient: runtime.apiClient,
      execSql: runtime.dbStatus === "ready" ? runtime.execSql : null,
      organizationId: runtime.organizationId,
      parentId: input.parentId ?? null,
    });
  }

  loadDocumentInfo(input: DocumentInfoInput): Promise<DocumentInfo> {
    const runtime = this.runtimeService.workflowInput();
    return loadDocumentInfo({
      ...input,
      apiClient: runtime.apiClient,
      execSql: runtime.dbStatus === "ready" ? runtime.execSql : null,
    });
  }

  refreshDocuments(): Promise<ReadonlyArray<DocumentSummary> | null> {
    const runtime = createContainerContentsDiscoveryRuntime(
      this.runtimeService.workflowInput(),
    );
    if (!runtime) {
      return Promise.resolve(null);
    }

    return refreshAllContainerDocumentsFromApi({
      ...createContainerDocumentDiscoveryPersistence(runtime),
      apiClient: runtime.apiClient,
      cacheReferencedPrincipalPolicies:
        runtime.cacheReferencedPrincipalPolicies,
    });
  }

  runtime(): ContainerContentsWorkflowRuntime {
    return createContainerContentsWorkflowRuntime(
      this.runtimeService.workflowInput(),
    );
  }
}

function createContainerContentsDiscoveryRuntime(
  input: InternalWorkflowRuntimeInput,
): ContainerContentsWorkflowRuntime | null {
  if (input.dbStatus !== "ready") {
    return null;
  }

  return createContainerContentsWorkflowRuntime(input);
}

function createContainerDocumentDiscoveryPersistence(
  runtime: ContainerContentsWorkflowRuntime,
): ContainerDocumentDiscoveryPersistence {
  const readModel = createContainerDocumentReadModelFromRuntime(runtime);

  return {
    applyContainerDocumentTombstones: (tombstones) =>
      readModel.applyContainerDocumentTombstones(tombstones),
    loadContainerDocumentWatermark: (containerId) =>
      readModel.loadContainerDocumentWatermark(containerId),
    replaceDocumentLinksBatch: (inputs) =>
      readModel.replaceDocumentLinksBatch(inputs),
    saveContainerDocumentWatermark: (containerId, watermark) =>
      readModel.saveContainerDocumentWatermark(containerId, watermark),
    upsertDiscoveredDocuments: (inputs) =>
      readModel.upsertDiscoveredDocuments(inputs),
  };
}
