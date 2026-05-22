import {
  type ContainerDocumentsWorkflowRuntime,
  createContainerDocumentsWorkflowRuntime,
} from "../workflows/container-documents";
import type { TearleadsRuntime } from "./workflowRuntime";

export interface TearleadsContainerDocuments {
  runtime(): ContainerDocumentsWorkflowRuntime;
}

export function createTearleadsContainerDocuments(
  runtime: TearleadsRuntime,
): TearleadsContainerDocuments {
  return new TearleadsContainerDocumentsService(runtime);
}

class TearleadsContainerDocumentsService
  implements TearleadsContainerDocuments
{
  constructor(private readonly runtimeService: TearleadsRuntime) {}

  runtime(): ContainerDocumentsWorkflowRuntime {
    return createContainerDocumentsWorkflowRuntime(this.runtimeService.input());
  }
}
