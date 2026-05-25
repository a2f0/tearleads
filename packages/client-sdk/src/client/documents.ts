import type { DocumentSummary } from "../data/documentSummary";
import { DEFAULT_DOCUMENT_KIND } from "../data/documents/documentConstants";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../workflows/documents";
import type { TearleadsInternalRuntime } from "./workflowRuntime";

export interface TearleadsListLocalDocumentSummariesInput {
  documentKind?: StoredDocumentKind | undefined;
}

export interface TearleadsDocuments {
  deleteLocalDocument(localId: string): Promise<boolean>;
  listLocalSummaries(
    input?: TearleadsListLocalDocumentSummariesInput | undefined,
  ): Promise<ReadonlyArray<DocumentSummary> | null>;
  runtime(containerId?: string | null | undefined): DocumentsWorkflowRuntime;
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

  runtime(
    containerId = this.dependencies.getDefaultContainerId(),
  ): DocumentsWorkflowRuntime {
    const input = this.dependencies.runtime.workflowInput(containerId);
    return createDocumentsWorkflowRuntime(input);
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
