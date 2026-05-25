import type { DocumentSummary } from "../data/documentSummary";
import { DEFAULT_DOCUMENT_KIND } from "../data/documents/documentConstants";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  DEFAULT_DOCUMENT_ID as DEFAULT_LOCAL_DOCUMENT_ID,
  type DocumentStore,
  type DocumentsRuntime,
  getOrCreateDocumentStore,
  type PersistedDocumentListener,
  primeDocumentStore,
  subscribeToPersistedDocuments,
} from "../stores/documents";
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

export interface ListLocalDocumentSummariesInput {
  documentKind?: StoredDocumentKind | undefined;
}

export { DEFAULT_LOCAL_DOCUMENT_ID as DEFAULT_DOCUMENT_ID };

export interface DocumentStoreInput {
  readonly containerId?: string | null | undefined;
  readonly documentId?: string | null | undefined;
  readonly initialDocumentKind?: StoredDocumentKind | undefined;
  readonly initialText?: string | undefined;
  readonly localId?: string | undefined;
}

export interface PrimeDocumentStoreInput extends DocumentStoreInput {
  readonly localId: string;
}

export interface SubscribeToLocalSummariesOptions {
  readonly containerId?: string | null | undefined;
}

export interface Documents {
  deleteLocalDocument(localId: string): Promise<boolean>;
  listLocalSummaries(
    input?: ListLocalDocumentSummariesInput | undefined,
  ): Promise<ReadonlyArray<DocumentSummary> | null>;
  primeStore(
    input: PrimeDocumentStoreInput,
    runtime?: DocumentsRuntime | undefined,
  ): DocumentStore;
  runtime(containerId?: string | null | undefined): DocumentsRuntime;
  store(
    input?: DocumentStoreInput | undefined,
    runtime?: DocumentsRuntime | undefined,
  ): DocumentStore;
  subscribeToLocalSummaries(
    listener: PersistedDocumentListener,
    options?: SubscribeToLocalSummariesOptions | undefined,
  ): () => void;
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

  async deleteLocalDocument(localId: string): Promise<boolean> {
    const runtime = this.runtime();
    if (runtime.infra.dbStatus !== "ready") {
      return false;
    }

    await deletePersistedDocument({
      documentProjectors: runtime.infra.documentProjectors,
      execSql: runtime.infra.execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
    return true;
  }

  async listLocalSummaries(
    input: ListLocalDocumentSummariesInput = {},
  ): Promise<ReadonlyArray<DocumentSummary> | null> {
    const runtime = this.dependencies.runtime.workflowInput();
    if (runtime.infra.dbStatus !== "ready") {
      return null;
    }

    await this.ensureSchema(runtime.infra.execSql);
    const summaries = await defaultDocumentsPersistence.listDocuments(
      runtime.infra.execSql,
    );
    if (!input.documentKind) {
      return summaries;
    }

    return summaries.filter(
      (summary) =>
        (summary.documentKind ?? DEFAULT_DOCUMENT_KIND) === input.documentKind,
    );
  }

  primeStore(
    input: PrimeDocumentStoreInput,
    runtimeOverride?: DocumentsRuntime | undefined,
  ): DocumentStore {
    const {
      containerId,
      documentId = null,
      initialDocumentKind = DEFAULT_DOCUMENT_KIND,
      initialText = "",
      localId,
    } = input;
    const runtime = runtimeOverride ?? this.runtime(containerId);
    return primeDocumentStore(
      runtime.state.domainScope,
      localId,
      runtime,
      documentId,
      initialText,
      initialDocumentKind,
    );
  }

  runtime(
    containerId = this.dependencies.getDefaultContainerId(),
  ): DocumentsRuntime {
    const input = this.dependencies.runtime.workflowInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }

  store(
    input: DocumentStoreInput = {},
    runtimeOverride?: DocumentsRuntime | undefined,
  ): DocumentStore {
    const {
      containerId,
      documentId = null,
      initialDocumentKind = DEFAULT_DOCUMENT_KIND,
      initialText = "",
      localId = DEFAULT_LOCAL_DOCUMENT_ID,
    } = input;
    const runtime = runtimeOverride ?? this.runtime(containerId);
    return getOrCreateDocumentStore(
      runtime.state.domainScope,
      localId,
      runtime,
      documentId,
      initialText,
      initialDocumentKind,
    );
  }

  subscribeToLocalSummaries(
    listener: PersistedDocumentListener,
    options: SubscribeToLocalSummariesOptions = {},
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
