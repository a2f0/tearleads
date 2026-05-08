import { useMemo } from "react";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import {
  createExplorerDocumentReadModel,
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
  const { execSql } = appData;

  return useMemo(() => createExplorerDocumentReadModel(execSql), [execSql]);
}
