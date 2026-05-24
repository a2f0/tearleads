import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "../workflows/documents";
import type { TearleadsInternalRuntime } from "./workflowRuntime";

export interface TearleadsDocuments {
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

  runtime(
    containerId = this.dependencies.getDefaultContainerId(),
  ): DocumentsWorkflowRuntime {
    const input = this.dependencies.runtime.workflowInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }
}
