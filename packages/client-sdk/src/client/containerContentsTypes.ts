import type { DocumentSummary } from "../data/documentSummary";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import type {
  ContainerContentsStore,
  ContainerContentsStoreOptions,
} from "../stores/container-contents";
import type { DocumentStore } from "../stores/documents";
import type {
  BlobInfoInput,
  BlobInfoList,
} from "../workflows/container-contents/blobInfo";
import type {
  ContainerInfo,
  ContainerInfoRemoteMode,
} from "../workflows/container-contents/containerInfo";
import type {
  DocumentInfo,
  DocumentInfoRemoteMode,
} from "../workflows/container-contents/documentInfo";
import type { ContainerDocumentQueries } from "../workflows/container-contents/documentQueries";
import type { SetLinkedContainerIdsForDocument } from "../workflows/container-contents/documentStructure";
import type { ContainerContentsProjectionUserKeyResolver } from "../workflows/container-contents/projectionKeys";
import type { ContainerContentsWorkflowRuntime } from "../workflows/container-contents/runtime";
import type { DocumentsWorkflowRuntime } from "../workflows/documents";

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

export type MergeDocumentSummary = (nextDocument: DocumentSummary) => void;

export interface OpenContainerDocumentStoreInput {
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

export interface MoveDocumentToContainerInput
  extends ContainerDocumentLinkInput {
  readonly expandNode: (nodeId: string) => void;
  readonly setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  readonly targetContainerId: string;
}

export interface LinkDocumentToContainerInput
  extends ContainerDocumentLinkInput {
  readonly setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  readonly targetContainerId: string;
}

export interface UnlinkDocumentFromContainerInput
  extends ContainerDocumentLinkInput {
  readonly removedContainerId: string;
  readonly setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}

export interface SetActiveDocumentContainerInput
  extends ContainerDocumentLinkInput {
  readonly targetContainerId: string;
}

export interface ContainerDocumentLinkActions
  extends ContainerContentsWorkflowRuntime {
  documentWorkflowRuntime(containerId: string): DocumentsWorkflowRuntime;
  openDocumentStore(input: OpenContainerDocumentStoreInput): DocumentStore;
  setActiveDocumentContainer(
    input: SetActiveDocumentContainerInput,
  ): Promise<DocumentSummary | null>;
  readonly canMutateDocumentLinks: boolean;
  readonly canMutateLocalDocumentLinks: boolean;
  linkDocumentToContainer(
    input: LinkDocumentToContainerInput,
  ): Promise<DocumentSummary | null>;
  moveDocumentToContainer(
    input: MoveDocumentToContainerInput,
  ): Promise<{ linksChanged: boolean; note: DocumentSummary | null }>;
  readonly resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  unlinkDocumentFromContainer(
    input: UnlinkDocumentFromContainerInput,
  ): Promise<DocumentSummary | null>;
}

/**
 * High-level container-content service for document discovery and diagnostics.
 *
 * The facade owns the normal SDK protocol: it supplies the API client,
 * referenced-principal policy cache, local document query facade, link
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
  openStore(
    options?: ContainerContentsStoreOptions | undefined,
  ): ContainerContentsStore;

  /**
   * Create the default local query facade for container contents.
   *
   * The facade is bound to the current SDK runtime snapshot, including the
   * active SQLite executor. Recreate it when the SDK runtime version changes.
   */
  localQueries(): ContainerDocumentQueries;

  /**
   * Create the default action bundle for document-link workflows.
   *
   * The returned object includes the current container-contents runtime,
   * the document projection-key resolver, mutation readiness, document store
   * priming, and container document-link mutations. Product stores can pass
   * this bundle around without rebuilding SDK runtime plumbing themselves.
   */
  documentLinkActions(): ContainerDocumentLinkActions;

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
  discoverContainerDocuments(
    containerId: string,
  ): Promise<ReadonlyArray<DocumentSummary> | null>;

  /**
   * Check whether the current event snapshot includes document updates that
   * are not yet represented by the supplied known remote document ids.
   */
  hasUnseenDocumentUpdates(knownDocumentIds: ReadonlySet<string>): boolean;

  /**
   * Load diagnostic information for one local document.
   *
   * Local details are available when SQLite is ready. Remote details are loaded
   * from the document writer projection according to `remoteInfoMode`; the
   * default is `"always"`.
   */
  loadDocumentInfo(input: DocumentInfoInput): Promise<DocumentInfo>;

  /**
   * List local blob projections and pending attachment bytes grouped by blob.
   *
   * This is a reverse lookup query: callers can search by server blob id,
   * local storage key, document id/title, attachment slot, or MIME metadata and
   * then traverse matching blobs back to their owning local documents.
   */
  listBlobInfo(input?: BlobInfoInput | undefined): Promise<BlobInfoList>;

  /**
   * Load diagnostic information for one container.
   *
   * Local details include synced timestamps. Remote details are loaded from the
   * container writer projection according to `remoteInfoMode`; the default is
   * `"always"`. Pass `parentId` when inspecting a container before its local row
   * has been synced.
   */
  loadContainerInfo(input: ContainerInfoInput): Promise<ContainerInfo>;

  /**
   * Refresh document discovery for every remotely visible container.
   *
   * The method discovers the remote container tree first, then applies each
   * container-document lane through the same local persistence protocol as
   * `discoverContainerDocuments`.
   *
   * Returns all document summaries touched by the refresh, or `null` when the
   * local database is unavailable, or when the remote container tree or a
   * document lane could not be fully listed.
   */
  refreshAllContainerDocuments(): Promise<ReadonlyArray<DocumentSummary> | null>;

  /**
   * Create a workflow runtime for advanced container-content workflows.
   *
   * Prefer the high-level methods on this service for the default SDK protocol.
   * Use this when constructing lower-level stores or custom workflows that need
   * access to the current runtime snapshot.
   */
  workflowRuntime(): ContainerContentsWorkflowRuntime;
}
