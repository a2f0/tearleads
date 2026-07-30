import { DEFAULT_DOCUMENT_KIND } from "../data/documents/documentConstants";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import type {
  DocumentSummaryList,
  DocumentSummarySort,
  DocumentSummarySortDirection,
  DocumentSummarySortKey,
  ListDocumentSummariesInput,
} from "../data/persistence/documents/types";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  DEFAULT_DOCUMENT_ID as DEFAULT_LOCAL_DOCUMENT_ID,
  type DocumentStore,
  type DocumentsRuntime,
  openDocumentStore,
  type PersistedDocumentListener,
  subscribeToPersistedDocuments,
} from "../stores/documents";
import { emitPersistedDocumentDeletion } from "../stores/documents/registry";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../workflows/documents";
import type { InternalRuntime } from "./workflowRuntime";

export type {
  DocumentAttachmentStatus,
  DocumentAttachmentUpload,
  DocumentContextValue,
  DocumentStore,
  DocumentsRuntime,
  PersistedDocumentListener,
} from "../stores/documents";

export type DocumentSortDirection = DocumentSummarySortDirection;
export type DocumentSortKey = DocumentSummarySortKey;

export type DocumentSort = DocumentSummarySort;

export interface ListDocumentsInput extends ListDocumentSummariesInput {}

export type DocumentList = DocumentSummaryList;

export { DEFAULT_LOCAL_DOCUMENT_ID as DEFAULT_DOCUMENT_ID };

export interface OpenDocumentInput {
  readonly containerId?: string | null | undefined;
  readonly documentId?: string | null | undefined;
  readonly initialDocumentKind?: StoredDocumentKind | undefined;
  readonly initialText?: string | undefined;
  readonly localId?: string | undefined;
}

export interface OpenDocumentOptions {
  readonly workflowRuntime?: DocumentsRuntime | undefined;
}

export interface DocumentSubscriptionOptions {
  readonly containerId?: string | null | undefined;
}

export interface Documents {
  delete(localId: string): Promise<boolean>;
  list(input?: ListDocumentsInput | undefined): Promise<DocumentList | null>;
  open(
    input?: OpenDocumentInput | undefined,
    options?: OpenDocumentOptions | undefined,
  ): DocumentStore;
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

  async delete(localId: string): Promise<boolean> {
    const runtime = this.workflowRuntime();
    if (runtime.infra.dbStatus !== "ready") {
      return false;
    }

    await deletePersistedDocument({
      documentProjectors: runtime.infra.documentProjectors,
      execSql: runtime.infra.execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
    emitPersistedDocumentDeletion(runtime.state.domainScope, localId);
    return true;
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
    const input = this.dependencies.runtime.workflowInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }

  open(
    input: OpenDocumentInput = {},
    options: OpenDocumentOptions = {},
  ): DocumentStore {
    const {
      containerId,
      documentId = null,
      initialDocumentKind = DEFAULT_DOCUMENT_KIND,
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
    );
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
