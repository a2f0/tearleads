import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { useCallback } from "react";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import type {
  ExplorerContainerDocumentTombstone,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "../../../stores/explorer/documentReadModel";
import {
  useDiscoveredDocumentsSync,
  usePrimeDiscoveredDocuments,
} from "../../../stores/explorer/useDiscoveredDocumentsSync";
import { useExplorerRefreshAction } from "../../../stores/explorer/useExplorerRefreshAction";
import type { ExplorerModelExplorer } from "./explorerModelTypes";

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
  const { containerContents } = useTearleads();
  const discoverDocuments = useCallback(
    (...args: Parameters<typeof containerContents.discoverDocuments>) =>
      containerContents.discoverDocuments(...args),
    [containerContents],
  );
  const refreshDocuments = useCallback(
    (...args: Parameters<typeof containerContents.refreshDocuments>) =>
      containerContents.refreshDocuments(...args),
    [containerContents],
  );
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments({
    appData,
  });
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
  useDiscoveredDocumentsSync({
    activeContainerId,
    appData,
    applyContainerDocumentTombstones,
    discoverDocuments,
    documentReadModel,
    knownDocumentIds,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
  });

  return useExplorerRefreshAction({
    applyContainerDocumentTombstones,
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh: explorer.refresh,
    refreshDocuments,
  });
}
