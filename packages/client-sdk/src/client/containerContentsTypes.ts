import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import type { DocumentSummary } from "../data/documents/documentSummary";
import type {
  ContainerContentsStore,
  ContainerContentsStoreOptions,
  ContainerContentsStoreRuntime,
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
  DocumentAttributionRangesInput,
  DocumentAttributionRangesPage,
} from "../workflows/container-contents/documentAttributionRanges";
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
 * - `attributionRequestKey`: Optional freshness generation used to coalesce
 *   duplicate attribution reads without joining requests across invalidation.
 * - `localId`: Local document id stored in the client database.
 * - `remoteInfoMode`: Controls whether remote projection details are fetched.
 */
export interface DocumentInfoInput {
  attributionRequestKey?: string | undefined;
  localId: string;
  remoteInfoMode?: DocumentInfoRemoteMode | undefined;
}

export type MergeDocumentSummary = (nextDocument: DocumentSummary) => void;

export interface OpenContainerDocumentInput {
  readonly containerId: string | null;
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
  readonly replaceLinkedContainers?: boolean | undefined;
  readonly setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  readonly sourceContainerId?: string | null | undefined;
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

export interface PurgeDocumentInput {
  /** The current local summary of the document to destroy. */
  readonly note: DocumentSummary;
}

export interface PurgeDocumentResult {
  readonly documentId: string;
  readonly purgedAt: string;
  readonly reclaimedBlobStorageKeys: ReadonlyArray<string>;
}

export interface ContainerDocumentLinks
  extends ContainerContentsWorkflowRuntime {
  documentRuntime(containerId: string | null): DocumentsWorkflowRuntime;
  openDocument(input: OpenContainerDocumentInput): DocumentStore;
  setActiveDocumentContainer(
    input: SetActiveDocumentContainerInput,
  ): Promise<DocumentSummary | null>;
  readonly canMutateDocumentLinks: boolean;
  readonly canMutateUnsyncedDocumentLinks: boolean;
  linkDocumentToContainer(
    input: LinkDocumentToContainerInput,
  ): Promise<DocumentSummary | null>;
  moveDocumentToContainer(
    input: MoveDocumentToContainerInput,
  ): Promise<{ linksChanged: boolean; note: DocumentSummary | null }>;
  /**
   * Permanently destroy a local-only document, or submit and verify a signed
   * terminal purge for a remote document. Remote purge requires exactly one
   * remaining container link and returns null on refusal or verification
   * failure.
   */
  purgeDocument(input: PurgeDocumentInput): Promise<PurgeDocumentResult | null>;
  readonly resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  unlinkDocumentFromContainer(
    input: UnlinkDocumentFromContainerInput,
  ): Promise<DocumentSummary | null>;
}

/**
 * High-level container-content service for tree state, document lists, document
 * links, discovery, and diagnostics.
 *
 * The facade owns the normal SDK protocol: it supplies the API client,
 * referenced-principal policy cache, local document query helpers, link
 * projection, tombstone handling, and sync watermarks. Consumers that need a
 * custom persistence protocol can call the lower-level workflows directly from
 * `@tearleads/client-sdk`.
 */
export interface ContainerContents {
  /**
   * Open the container tree state store for the current SDK runtime.
   *
   * The store is cached per domain scope and created from the current runtime
   * snapshot. Long-lived hosts should call `updateRuntime` after runtime
   * changes, such as from a React effect.
   */
  openTree(
    options?: ContainerContentsStoreOptions | undefined,
  ): ContainerContentsStore;

  /**
   * Create local document query helpers for container contents.
   *
   * The facade is bound to the current SDK runtime snapshot, including the
   * active SQLite executor. Recreate it when the SDK runtime version changes.
   */
  documentQueries(): ContainerDocumentQueries;

  /**
   * Create the default document-link workflow helper.
   *
   * The returned object includes the current container-contents runtime,
   * the document projection-key resolver, mutation readiness, document store
   * priming, and container document-link mutations. Product stores can pass
   * this bundle around without rebuilding SDK runtime plumbing themselves.
   */
  documentLinks(): ContainerDocumentLinks;

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
   * Sync the content of a single document that no mini-app has opened.
   *
   * Discovery only records a document's metadata + an empty content shell, and a
   * document's locally authored content is only pushed once its store syncs; both
   * normally happen lazily when a mini-app opens the document. Some documents are
   * never opened yet still need to sync — notably the organization profile
   * document, which lives in an org's Members-granted metadata container and
   * holds the org display name. This opens a transient document store (registered
   * under the container's keys, so it can decrypt) and schedules a remote sync
   * pass. The pass both pushes the store's pending updates and merges + persists
   * any remote body, so the same call lets an owning device publish its profile
   * content and a member device pull it. `documentId` may be omitted; the store
   * then resolves it from the persisted record (the owning device keys the
   * document under a local alias, not its server id).
   */
  pullDocumentContent(input: {
    containerId: string;
    localId: string;
    documentId?: string | null | undefined;
  }): void;

  /**
   * Load diagnostic information for one local document.
   *
   * Local details are available when SQLite is ready. Remote details are loaded
   * from the document writer projection according to `remoteInfoMode`; the
   * default is `"if-synced"`.
   */
  loadDocumentInfo(input: DocumentInfoInput): Promise<DocumentInfo>;

  /**
   * Fetch a synced document's compact edit-attribution segments (peer -> writer
   * intervals) on their own, without the writer-projection/attachment work
   * `loadDocumentInfo` also does. Resolves to `null` on any request failure.
   * Callers must ignore the segments when `truncated` is set — a truncated
   * interval list can drop a peer's segments and mis-resolve it.
   */
  loadDocumentEditAttribution(
    documentId: string,
  ): Promise<DocumentEditAttributionResponse | null>;

  /** Load one revision-bound page of detailed per-upload edit attribution. */
  loadDocumentAttributionRanges(
    input: DocumentAttributionRangesInput,
  ): Promise<DocumentAttributionRangesPage>;

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
   * Create a workflow runtime for advanced container-content workflows.
   *
   * Prefer the high-level methods on this service for the default SDK protocol.
   * Use this when constructing lower-level stores or custom workflows that need
   * access to the current runtime snapshot.
   */
  workflowRuntime(): ContainerContentsStoreRuntime;
}
