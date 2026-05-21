import {
  createExplorerWorkflowRuntime,
  type ExplorerWorkflowRuntime,
} from "../workflows/explorer";
import type { TearleadsWorkflowRuntimeInput } from "./workflowRuntime";

interface TearleadsExplorerDependencies {
  createWorkflowRuntimeInput: () => TearleadsWorkflowRuntimeInput;
}

export class TearleadsExplorer {
  constructor(private readonly dependencies: TearleadsExplorerDependencies) {}

  runtime(): ExplorerWorkflowRuntime {
    return createExplorerWorkflowRuntime(
      this.dependencies.createWorkflowRuntimeInput(),
    );
  }
}
