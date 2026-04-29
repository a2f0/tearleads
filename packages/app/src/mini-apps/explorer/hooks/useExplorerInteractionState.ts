import { useCallback } from "react";
import type { useAppData } from "../../../data/AppDataProvider";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/containers";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import { useDiscoveredDocumentsSync } from "./useDiscoveredDocumentsSync";
import { useExplorerRefreshAction } from "./useExplorerRefreshAction";

export function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  appData: ReturnType<typeof useAppData>;
  explorer: ExplorerModelExplorer;
  knownDocumentIds: ReadonlySet<string>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: () => void;
}) {
  const {
    activeContainerId,
    appData,
    explorer,
    knownDocumentIds,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
  } = params;
  const replaceDocumentLinksBatch = useCallback(
    async (
      inputs: ReadonlyArray<{
        containerIds: ReadonlyArray<string>;
        documentId: string;
      }>,
    ) => {
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        appData.execSql,
        inputs,
      );
      onDocumentLinksChanged();
    },
    [appData.execSql, onDocumentLinksChanged],
  );
  const { primeDiscoveredDocuments } = useDiscoveredDocumentsSync({
    activeContainerId,
    appData,
    knownDocumentIds,
    mergeDocumentSummaries,
    replaceDocumentLinksBatch,
  });

  return useExplorerRefreshAction({
    appData,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh: explorer.refresh,
  });
}
