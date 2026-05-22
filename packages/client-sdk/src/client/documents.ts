import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "../workflows/documents";
import type { TearleadsInternalRuntime } from "./workflowRuntime";

export interface TearleadsDocumentsRuntimeOptions {
  containerId?: string | null | undefined;
}

export interface TearleadsDocuments {
  runtime(options?: TearleadsDocumentsRuntimeOptions): DocumentsWorkflowRuntime;
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
    options: TearleadsDocumentsRuntimeOptions = {},
  ): DocumentsWorkflowRuntime {
    const containerId = Object.hasOwn(options, "containerId")
      ? options.containerId
      : this.dependencies.getDefaultContainerId();
    const input = this.dependencies.runtime.workflowInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }
}
