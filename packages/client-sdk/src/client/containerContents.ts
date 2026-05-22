import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsWorkflowRuntime,
} from "../workflows/container-contents";
import type { TearleadsRuntime } from "./workflowRuntime";

export interface TearleadsContainerContents {
  runtime(): ContainerContentsWorkflowRuntime;
}

export function createTearleadsContainerContents(
  runtime: TearleadsRuntime,
): TearleadsContainerContents {
  return new TearleadsContainerContentsService(runtime);
}

class TearleadsContainerContentsService implements TearleadsContainerContents {
  constructor(private readonly runtimeService: TearleadsRuntime) {}

  runtime(): ContainerContentsWorkflowRuntime {
    return createContainerContentsWorkflowRuntime(this.runtimeService.input());
  }
}
