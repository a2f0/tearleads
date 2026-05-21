import {
  createExplorerWorkflowRuntime,
  type ExplorerWorkflowRuntime,
} from "../workflows/explorer";
import type { TearleadsRuntime } from "./workflowRuntime";

export interface TearleadsExplorer {
  runtime(): ExplorerWorkflowRuntime;
}

export function createTearleadsExplorer(
  runtime: TearleadsRuntime,
): TearleadsExplorer {
  return new TearleadsExplorerService(runtime);
}

class TearleadsExplorerService implements TearleadsExplorer {
  constructor(private readonly runtimeService: TearleadsRuntime) {}

  runtime(): ExplorerWorkflowRuntime {
    return createExplorerWorkflowRuntime(this.runtimeService.input());
  }
}
