import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import type { DiscoveredDocumentInput } from "../../data/documents/documentSummary";
import type {
  DocumentSummaryList,
  DocumentSummarySort,
  DocumentSummarySortDirection,
  DocumentSummarySortKey,
  ListDocumentSummariesInput,
} from "../../data/persistence/documents/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createSeededDocument,
  DEFAULT_DOCUMENT_ID as DEFAULT_LOCAL_DOCUMENT_ID,
  type DocumentStore,
  type DocumentStoreOpenOptions,
  type DocumentsRuntime,
  openDocumentStore,
  type PersistedDocumentListener,
  retryDocumentDownload,
  type SeededDocumentInput,
  subscribeToPersistedDocuments,
} from "../../stores/documents";
import { emitPersistedDocumentDeletion } from "../../stores/documents/registry";
import {
  createDocumentsWorkflowRuntimeFromSnapshot,
  type DocumentFoundingUpdate,
  type DocumentHistory,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentHistory,
  readDocumentFoundingUpdate,
  reclaimDocumentOrphanBlobs,
} from "../../workflows/documents";
import type { InternalRuntime } from "../runtime/workflowRuntime";

export type {
  DocumentAttachmentStatus,
  DocumentAttachmentUpload,
  DocumentContextValue,
  DocumentStore,
  DocumentsRuntime,
  PersistedDocumentListener,
} from "../../stores/documents";

export type {
  DocumentFoundingUpdate,
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryRowChange,
  DocumentHistoryStop,
  DocumentHistoryTextChange,
  DocumentHistoryVersion,
  DocumentHistoryVersionEntry,
  DocumentHistoryView,
} from "../../workflows/documents";

export type DocumentSortDirection = DocumentSummarySortDirection;
export type DocumentSortKey = DocumentSummarySortKey;

export type DocumentSort = DocumentSummarySort;

export interface ListDocumentsInput extends ListDocumentSummariesInput {}

export type DocumentList = DocumentSummaryList;

export type { SeededDocumentInput } from "../../stores/documents";
export interface OpenDocumentInput {
  readonly containerId?: string | null | undefined;
  readonly documentId?: string | null | undefined;
  readonly initialDocumentKind?: StoredDocumentKind | undefined;
  /** Birth content of a created record; see `DocumentStoreOpenOptions`. */
  readonly initialRows?: DocumentStoreOpenOptions["initialRows"];
  readonly initialStructuredFields?: DocumentStoreOpenOptions["initialStructuredFields"];
  readonly initialText?: string | undefined;
  readonly localId?: string | undefined;
}
export { DEFAULT_LOCAL_DOCUMENT_ID as DEFAULT_DOCUMENT_ID };

export interface OpenDocumentOptions {
  /** False opens only an existing record; see `DocumentStoreOpenOptions`. */
  readonly createIfMissing?: boolean | undefined;
  readonly remoteSyncMode?: "on-demand" | "startup" | undefined;
  readonly workflowRuntime?: DocumentsRuntime | undefined;
}

export interface RetryDocumentDownloadInput {
  readonly documentId: string;
  readonly localId: string;
}

export interface DocumentSubscriptionOptions {
  readonly containerId?: string | null | undefined;
}

export interface Documents {
  createSeeded(
    input: SeededDocumentInput,
  ): Promise<DiscoveredDocumentInput | "purged">;
  delete(localId: string): Promise<boolean>;
  findLocalIdByDocumentId(documentId: string): Promise<string | null>;
  list(input?: ListDocumentsInput | undefined): Promise<DocumentList | null>;
  open(
    input?: OpenDocumentInput | undefined,
    options?: OpenDocumentOptions | undefined,
  ): DocumentStore;
  /**
   * Open a read-only replay of a document's durable local history. Resolves to
   * null while the database is not ready or the document has no history yet.
   * The caller must `close()` the result.
   */
  openHistory(localId: string): Promise<DocumentHistory | null>;
  /**
   * Pull a synced document's founding update, the first update the server
   * committed for it, verify it, and replay it alone. Later edits cannot
   * change what it shows. Resolves to null while the database is not ready,
   * offline, or when the document has no ordinary first update to read.
   */
  readFoundingUpdate(localId: string): Promise<DocumentFoundingUpdate | null>;
  /**
   * Pull a synced document again and re-list its attachment bindings, e.g.
   * to retry a pending first download. Resolves false, without syncing, when
   * the database is not ready or the local record no longer carries
   * `documentId`; an already-open store keeps its runtime and draft.
   */
  retryDownload(input: RetryDocumentDownloadInput): Promise<boolean>;
  subscribe(
    listener: PersistedDocumentListener,
    options?: DocumentSubscriptionOptions | undefined,
  ): () => void;
  workflowRuntime(containerId?: string | null | undefined): DocumentsRuntime;
}

interface DocumentsDependencies {
  getDefaultContainerId: () => string | null;
  runtime: InternalRuntime;
}

export function createDocuments(
  dependencies: DocumentsDependencies,
): Documents {
  return new DocumentsService(dependencies);
}

class DocumentsService implements Documents {
  private readonly schemaEnsuresByExecSql = new WeakMap<
    ExecSql,
    Promise<void>
  >();

  constructor(private readonly dependencies: DocumentsDependencies) {}

  createSeeded(input: SeededDocumentInput) {
    const { runtime } = this.dependencies;
    const generation = runtime.scopeGeneration;
    return createSeededDocument(
      this.workflowRuntime(input.containerId),
      input,
      () => runtime.scopeGeneration === generation,
    );
  }

  async delete(localId: string): Promise<boolean> {
    const runtime = this.workflowRuntime();
    if (runtime.infra.dbStatus !== "ready") {
      return false;
    }

    const deleted = await deletePersistedDocument({
      deleteDocumentPlacements: runtime.deleteDocumentPlacements,
      documentProjectors: runtime.infra.documentProjectors,
      execSql: runtime.infra.execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
    if (!deleted) return false;
    void reclaimDocumentOrphanBlobs(runtime);
    emitPersistedDocumentDeletion(runtime.state.domainScope, localId);
    return true;
  }

  async findLocalIdByDocumentId(documentId: string): Promise<string | null> {
    const runtime = this.dependencies.runtime.workflowInput();
    if (runtime.infra.dbStatus !== "ready") {
      return null;
    }

    await this.ensureSchema(runtime.infra.execSql);
    return defaultDocumentsPersistence.findLocalIdByDocumentId(
      runtime.infra.execSql,
      documentId,
    );
  }

  async list(input: ListDocumentsInput = {}): Promise<DocumentList | null> {
    const runtime = this.dependencies.runtime.workflowInput();
    if (runtime.infra.dbStatus !== "ready") {
      return null;
    }

    await this.ensureSchema(runtime.infra.execSql);
    return defaultDocumentsPersistence.listDocumentSummaries(
      runtime.infra.execSql,
      input,
    );
  }

  workflowRuntime(
    containerId = this.dependencies.getDefaultContainerId(),
  ): DocumentsRuntime {
    const { runtime } = this.dependencies;
    return createDocumentsWorkflowRuntimeFromSnapshot({
      ...runtime.workflowInput(containerId),
      deleteDocumentPlacements: runtime.deleteDocumentPlacements,
    });
  }

  open(
    input: OpenDocumentInput = {},
    options: OpenDocumentOptions = {},
  ): DocumentStore {
    const {
      containerId,
      documentId = null,
      initialDocumentKind = DEFAULT_DOCUMENT_KIND,
      initialRows,
      initialStructuredFields,
      initialText = "",
      localId = DEFAULT_LOCAL_DOCUMENT_ID,
    } = input;
    const runtime =
      options.workflowRuntime ?? this.workflowRuntime(containerId);
    return openDocumentStore(
      runtime.state.domainScope,
      localId,
      runtime,
      documentId,
      initialText,
      initialDocumentKind,
      {
        createIfMissing: options.createIfMissing,
        initialRows,
        initialStructuredFields,
        remoteSyncMode: options.remoteSyncMode,
      },
    );
  }

  async openHistory(localId: string): Promise<DocumentHistory | null> {
    const runtime = this.workflowRuntime();
    if (runtime.infra.dbStatus !== "ready") {
      return null;
    }

    await this.ensureSchema(runtime.infra.execSql);
    return openDocumentHistory({
      documentProjectors: runtime.infra.documentProjectors,
      execSql: runtime.infra.execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
  }

  async readFoundingUpdate(
    localId: string,
  ): Promise<DocumentFoundingUpdate | null> {
    const { runtime } = this.dependencies;
    const generation = runtime.scopeGeneration;
    const workflowRuntime = this.workflowRuntime();
    if (workflowRuntime.infra.dbStatus !== "ready") {
      return null;
    }

    await this.ensureSchema(workflowRuntime.infra.execSql);
    return readDocumentFoundingUpdate({
      localId,
      runtime: workflowRuntime,
      stillCurrent: () => runtime.scopeGeneration === generation,
    });
  }

  retryDownload(input: RetryDocumentDownloadInput): Promise<boolean> {
    return retryDocumentDownload({
      ...input,
      workflowRuntime: (containerId) => this.workflowRuntime(containerId),
    });
  }

  subscribe(
    listener: PersistedDocumentListener,
    options: DocumentSubscriptionOptions = {},
  ): () => void {
    return subscribeToPersistedDocuments(
      this.dependencies.runtime.workflowInput(options.containerId).state
        .domainScope,
      listener,
    );
  }

  private ensureSchema(execSql: ExecSql): Promise<void> {
    const existing = this.schemaEnsuresByExecSql.get(execSql);
    if (existing) {
      return existing;
    }

    const ensure = defaultDocumentsPersistence
      .ensureSchema(execSql)
      .catch((error: unknown) => {
        this.schemaEnsuresByExecSql.delete(execSql);
        throw error;
      });
    this.schemaEnsuresByExecSql.set(execSql, ensure);
    return ensure;
  }
}
