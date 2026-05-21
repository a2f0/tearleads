import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
} from "../workflows/documents";
import type { TearleadsWorkflowRuntimeInput } from "./workflowRuntime";

export interface TearleadsDocumentsRuntimeOptions {
  containerId?: string | null | undefined;
}

interface TearleadsDocumentsDependencies {
  createWorkflowRuntimeInput: (
    containerId?: string | null | undefined,
  ) => TearleadsWorkflowRuntimeInput;
  getDefaultContainerId: () => string | null;
}

export class TearleadsDocuments {
  constructor(private readonly dependencies: TearleadsDocumentsDependencies) {}

  runtime(
    options: TearleadsDocumentsRuntimeOptions = {},
  ): DocumentsWorkflowRuntime {
    const containerId = Object.hasOwn(options, "containerId")
      ? options.containerId
      : this.dependencies.getDefaultContainerId();
    const input = this.dependencies.createWorkflowRuntimeInput(containerId);
    return createDocumentsWorkflowRuntime(input);
  }
}
