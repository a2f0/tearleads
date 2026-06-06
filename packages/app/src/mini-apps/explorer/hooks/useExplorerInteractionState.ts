import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../../providers/sdk/TearleadsProvider";
import {
  useDiscoveredDocumentsSync,
  usePrimeDiscoveredDocuments,
} from "../../../stores/explorer/useDiscoveredDocumentsSync";
import { useExplorerRefreshAction } from "../../../stores/explorer/useExplorerRefreshAction";
import type { ExplorerModelExplorer } from "./explorerModelTypes";

export function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  appData: RuntimeSnapshot;
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
  const { containerContents } = useTearleads();
  const discoverContainerDocuments = useCallback(
    (containerId: string) =>
      containerContents.discoverContainerDocuments(containerId),
    [containerContents],
  );
  const refreshAllContainerDocuments = useCallback(
    () => containerContents.refreshAllContainerDocuments(),
    [containerContents],
  );
  const hasUnseenDocumentUpdates = useCallback(
    (knownDocumentIds: ReadonlySet<string>) =>
      containerContents.hasUnseenDocumentUpdates(knownDocumentIds),
    [containerContents],
  );
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments({
    appData,
  });
  useDiscoveredDocumentsSync({
    activeContainerId,
    appData,
    discoverContainerDocuments,
    hasUnseenDocumentUpdates,
    knownDocumentIds,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
  });

  return useExplorerRefreshAction({
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
    refresh: explorer.refresh,
    refreshAllContainerDocuments,
  });
}
