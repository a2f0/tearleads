import { useCallback } from "react";
import type { DocumentSummary } from "../../../data/documents/shared/documentSummary";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import type {
  ExplorerContainerDocumentTombstone,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "../../../stores/explorer/documentReadModel";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import { useDiscoveredDocumentsSync } from "./useDiscoveredDocumentsSync";
import { useExplorerRefreshAction } from "./useExplorerRefreshAction";

export function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  appData: ReturnType<typeof useAppData>;
  documentReadModel: ExplorerDocumentReadModel;
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
    documentReadModel,
    explorer,
    knownDocumentIds,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
  } = params;
  const replaceDocumentLinksBatch = useCallback(
    async (inputs: ReadonlyArray<ExplorerDocumentLinkInput>) => {
      await documentReadModel.replaceDocumentLinksBatch(inputs);
      onDocumentLinksChanged();
    },
    [documentReadModel, onDocumentLinksChanged],
  );
  const applyContainerDocumentTombstones = useCallback(
    async (tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>) => {
      if (tombstones.length === 0) {
        return [];
      }

      const updatedDocuments =
        await documentReadModel.applyContainerDocumentTombstones(tombstones);
      onDocumentLinksChanged();
      return updatedDocuments;
    },
    [documentReadModel, onDocumentLinksChanged],
  );
  const { primeDiscoveredDocuments } = useDiscoveredDocumentsSync({
    activeContainerId,
    appData,
    applyContainerDocumentTombstones,
    documentReadModel,
    knownDocumentIds,
    mergeDocumentSummaries,
    replaceDocumentLinksBatch,
  });

  return useExplorerRefreshAction({
    appData,
    applyContainerDocumentTombstones,
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh: explorer.refresh,
  });
}
