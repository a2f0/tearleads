import { useMemo } from "react";
import {
  createExplorerDocumentReadModelFromRuntime,
  createExplorerWorkflowRuntime,
  type ExplorerDocumentReadModel,
  type ExplorerWorkflowRuntimeInput,
} from "../../workflows/explorer";

export type {
  ExplorerContainerDocumentTombstone,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "../../workflows/explorer";

export function useExplorerDocumentReadModel(
  appData: ExplorerWorkflowRuntimeInput,
): ExplorerDocumentReadModel {
  return useMemo(
    () =>
      createExplorerDocumentReadModelFromRuntime(
        createExplorerWorkflowRuntime(appData),
      ),
    [appData],
  );
}
