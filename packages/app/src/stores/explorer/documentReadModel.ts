import { useMemo } from "react";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import {
  createExplorerDocumentReadModelFromRuntime,
  type ExplorerDocumentReadModel,
} from "../../workflows/explorer";

export type {
  ExplorerContainerDocumentTombstone,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "../../workflows/explorer";

export function useExplorerDocumentReadModel(
  appData: Pick<AppDataContextValue, "execSql">,
): ExplorerDocumentReadModel {
  return useMemo(
    () => createExplorerDocumentReadModelFromRuntime(appData),
    [appData.execSql],
  );
}
