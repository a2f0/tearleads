import type { DocumentSummary } from "../data/documentSummary";
import { DEFAULT_DOCUMENT_KIND } from "../data/documents/documentConstants";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  DEFAULT_DOCUMENT_ID as DEFAULT_LOCAL_DOCUMENT_ID,
  type DocumentAttachmentStatus,
  type DocumentAttachmentUpload,
  type DocumentContextValue,
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
import type { TearleadsInternalRuntime } from "./workflowRuntime";

export interface TearleadsListLocalDocumentSummariesInput {
  documentKind?: StoredDocumentKind | undefined;
}

export { DEFAULT_LOCAL_DOCUMENT_ID as DEFAULT_DOCUMENT_ID };

export type TearleadsDocumentAttachmentStatus = DocumentAttachmentStatus;
export type TearleadsDocumentAttachmentUpload = DocumentAttachmentUpload;
export type TearleadsDocumentContextValue = DocumentContextValue;
export type TearleadsDocumentStore = DocumentStore;
export type TearleadsDocumentsRuntime = DocumentsRuntime;
export type TearleadsPersistedDocumentListener = PersistedDocumentListener;

export interface TearleadsDocumentStoreInput {
  readonly containerId?: string | null | undefined;
  readonly documentId?: string | null | undefined;
  readonly initialDocumentKind?: StoredDocumentKind | undefined;
  readonly initialText?: string | undefined;
  readonly localId?: string | undefined;
}

export interface TearleadsPrimeDocumentStoreInput
  extends TearleadsDocumentStoreInput {
  readonly localId: string;
}

export interface TearleadsSubscribeToLocalSummariesOptions {
  readonly containerId?: string | null | undefined;
}

export interface TearleadsDocuments {
  deleteLocalDocument(localId: string): Promise<boolean>;
  listLocalSummaries(
    input?: TearleadsListLocalDocumentSummariesInput | undefined,
  ): Promise<ReadonlyArray<DocumentSummary> | null>;
  primeStore(
    input: TearleadsPrimeDocumentStoreInput,
    runtime?: TearleadsDocumentsRuntime | undefined,
  ): TearleadsDocumentStore;
  runtime(containerId?: string | null | undefined): TearleadsDocumentsRuntime;
  store(
    input?: TearleadsDocumentStoreInput | undefined,
    runtime?: TearleadsDocumentsRuntime | undefined,
  ): TearleadsDocumentStore;
  subscribeToLocalSummaries(
    listener: TearleadsPersistedDocumentListener,
    options?: TearleadsSubscribeToLocalSummariesOptions | undefined,
  ): () => void;
}

interface TearleadsDocumentsDependencies {
  getDefaultContainerId: () => string | null;
  runtime: TearleadsInternalRuntime;
}

export function createTearleadsDocuments(
  dependencies: TearleadsDocumentsDependencies,
): TearleadsDocuments {
  return new TearleadsDocumentsService(dependencies);
}

class TearleadsDocumentsService implements TearleadsDocuments {
  private readonly schemaEnsuresByExecSql = new WeakMap<
    ExecSql,
    Promise<void>
  >();

  constructor(private readonly dependencies: TearleadsDocumentsDependencies) {}

  async deleteLocalDocument(localId: string): Promise<boolean> {
    const runtime = this.runtime();
    if (runtime.dbStatus !== "ready") {
      return false;
    }

    await deletePersistedDocument({
      documentProjectors: runtime.documentProjectors,
      execSql: runtime.execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
    return true;
  }

  async listLocalSummaries(
    input: TearleadsListLocalDocumentSummariesInput = {},
  ): Promise<ReadonlyArray<DocumentSummary> | null> {
    const runtime = this.dependencies.runtime.workflowInput();
    if (runtime.dbStatus !== "ready") {
      return null;
    }

    await this.ensureSchema(runtime.execSql);
    const summaries = await defaultDocumentsPersistence.listDocuments(
      runtime.execSql,
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
    input: TearleadsPrimeDocumentStoreInput,
    runtimeOverride?: TearleadsDocumentsRuntime | undefined,
  ): TearleadsDocumentStore {
    const {
      containerId,
      documentId = null,
      initialDocumentKind = DEFAULT_DOCUMENT_KIND,
      initialText = "",
      localId,
    } = input;
    const runtime = runtimeOverride ?? this.runtime(containerId);
    return primeDocumentStore(
      runtime.domainScope,
      localId,
      runtime,
      documentId,
      initialText,
      initialDocumentKind,
    );
  }

  runtime(
    containerId = this.dependencies.getDefaultContainerId(),
  ): TearleadsDocumentsRuntime {
    const input = this.dependencies.runtime.workflowInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }

  store(
    input: TearleadsDocumentStoreInput = {},
    runtimeOverride?: TearleadsDocumentsRuntime | undefined,
  ): TearleadsDocumentStore {
    const {
      containerId,
      documentId = null,
      initialDocumentKind = DEFAULT_DOCUMENT_KIND,
      initialText = "",
      localId = DEFAULT_LOCAL_DOCUMENT_ID,
    } = input;
    const runtime = runtimeOverride ?? this.runtime(containerId);
    return getOrCreateDocumentStore(
      runtime.domainScope,
      localId,
      runtime,
      documentId,
      initialText,
      initialDocumentKind,
    );
  }

  subscribeToLocalSummaries(
    listener: TearleadsPersistedDocumentListener,
    options: TearleadsSubscribeToLocalSummariesOptions = {},
  ): () => void {
    return subscribeToPersistedDocuments(
      this.dependencies.runtime.workflowInput(options.containerId).domainScope,
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
