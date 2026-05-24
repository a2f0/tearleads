import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { useCallback } from "react";
import {
  type TearleadsRuntimeSnapshot,
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
  appData: TearleadsRuntimeSnapshot;
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
  const discoverDocuments = useCallback(
    (containerId: string) => containerContents.discoverDocuments(containerId),
    [containerContents],
  );
  const refreshDocuments = useCallback(
    () => containerContents.refreshDocuments(),
    [containerContents],
  );
  const { primeDiscoveredDocuments } = usePrimeDiscoveredDocuments({
    appData,
  });
  useDiscoveredDocumentsSync({
    activeContainerId,
    appData,
    discoverDocuments,
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
    refreshDocuments,
  });
}
