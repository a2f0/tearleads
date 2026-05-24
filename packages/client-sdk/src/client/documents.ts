import type { DocumentSummary } from "../data/documentSummary";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
} from "../workflows/documents";
import type { TearleadsInternalRuntime } from "./workflowRuntime";

export interface TearleadsListLocalDocumentSummariesInput {
  documentKind?: StoredDocumentKind | undefined;
}

export interface TearleadsDocuments {
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
  constructor(private readonly dependencies: TearleadsDocumentsDependencies) {}

  async listLocalSummaries(
    input: TearleadsListLocalDocumentSummariesInput = {},
  ): Promise<ReadonlyArray<DocumentSummary> | null> {
    const runtime = this.dependencies.runtime.workflowInput();
    if (runtime.dbStatus !== "ready") {
      return null;
    }

    await defaultDocumentsPersistence.ensureSchema(runtime.execSql);
    const summaries = await defaultDocumentsPersistence.listDocuments(
      runtime.execSql,
    );
    if (!input.documentKind) {
      return summaries;
    }

    return summaries.filter(
      (summary) => (summary.documentKind ?? "note") === input.documentKind,
    );
  }

  runtime(
    containerId = this.dependencies.getDefaultContainerId(),
  ): DocumentsWorkflowRuntime {
    const input = this.dependencies.runtime.workflowInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }
}
