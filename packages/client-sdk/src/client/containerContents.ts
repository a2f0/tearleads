import type { DocumentSummary } from "../data/documentSummary";
import {
  type ContainerContentsWorkflowRuntime,
  type ContainerDocumentReadModel,
  type ContainerInfo,
  type ContainerInfoRemoteMode,
  createContainerContentsWorkflowRuntime,
  createContainerDocumentReadModelFromRuntime,
  type DocumentInfo,
  type DocumentInfoRemoteMode,
  discoverContainerDocumentsFromApi,
  loadContainerInfo,
  loadDocumentInfo,
  refreshAllContainerDocumentsFromApi,
} from "../workflows/container-contents";
import type {
  TearleadsInternalRuntime,
  TearleadsInternalWorkflowRuntimeInput,
} from "./workflowRuntime";

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
export interface TearleadsContainerInfoInput {
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
export interface TearleadsDocumentInfoInput {
  localId: string;
  remoteInfoMode?: DocumentInfoRemoteMode | undefined;
}

/**
 * High-level container-content service for document discovery and diagnostics.
 *
 * The facade owns the normal SDK protocol: it supplies the API client,
 * referenced-principal policy cache, local document read model, link
 * projection, tombstone handling, and sync watermarks. Consumers that need a
 * custom persistence protocol can call the lower-level workflows directly from
 * `@tearleads/client-sdk/workflows/container-contents`.
 */
export interface TearleadsContainerContents {
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
   * Load diagnostic information for one local document.
   *
   * Local details are available when SQLite is ready. Remote details are loaded
   * from the document writer projection according to `remoteInfoMode`; the
   * default is `"always"`.
   */
  loadDocumentInfo(input: TearleadsDocumentInfoInput): Promise<DocumentInfo>;

  /**
   * Load diagnostic information for one container.
   *
   * Local details include synced timestamps. Remote details are loaded from the
   * container writer projection according to `remoteInfoMode`; the default is
   * `"always"`. Pass `parentId` when inspecting a container before its local row
   * has been synced.
   */
  loadInfo(input: TearleadsContainerInfoInput): Promise<ContainerInfo>;

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

export function createTearleadsContainerContents(
  runtime: TearleadsInternalRuntime,
): TearleadsContainerContents {
  return new TearleadsContainerContentsService(runtime);
}

class TearleadsContainerContentsService implements TearleadsContainerContents {
  constructor(private readonly runtimeService: TearleadsInternalRuntime) {}

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

  loadInfo(input: TearleadsContainerInfoInput): Promise<ContainerInfo> {
    const runtime = this.runtimeService.workflowInput();
    return loadContainerInfo({
      ...input,
      apiClient: runtime.apiClient,
      execSql: runtime.dbStatus === "ready" ? runtime.execSql : null,
      organizationId: runtime.organizationId,
      parentId: input.parentId ?? null,
    });
  }

  loadDocumentInfo(input: TearleadsDocumentInfoInput): Promise<DocumentInfo> {
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
  input: TearleadsInternalWorkflowRuntimeInput,
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
