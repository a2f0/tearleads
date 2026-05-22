import type { TearleadsContainerContents } from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { useCallback, useRef, useState } from "react";
import type {
  ExplorerContainerDocumentTombstone,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "./documentReadModel";
import { isDestroyedDatabaseWorkerError } from "./documentRuntime";

type ReplaceDocumentLinksBatch = (
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
) => Promise<void>;

type ApplyContainerDocumentTombstones = (
  tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>,
) => Promise<ReadonlyArray<DocumentSummary>>;

export function useExplorerRefreshAction(params: {
  applyContainerDocumentTombstones: ApplyContainerDocumentTombstones;
  documentReadModel: ExplorerDocumentReadModel;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  primeDiscoveredDocuments: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  replaceDocumentLinksBatch: ReplaceDocumentLinksBatch;
  refresh: () => Promise<boolean>;
  refreshDocuments: TearleadsContainerContents["refreshDocuments"];
}) {
  const {
    applyContainerDocumentTombstones,
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
    refreshDocuments,
  } = params;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const handleRefresh = useCallback((): Promise<boolean> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    setRefreshError(null);
    setIsRefreshing(true);

    const refreshPromise = (async (): Promise<boolean> => {
      const refreshed = await refresh();
      if (!refreshed) {
        setRefreshError("Refresh unavailable.");
        return false;
      }

      const discoveredDocumentSummaries = await refreshDocuments({
        applyContainerDocumentTombstones,
        loadContainerDocumentWatermark: (containerId) =>
          documentReadModel.loadContainerDocumentWatermark(containerId),
        replaceDocumentLinksBatch,
        saveContainerDocumentWatermark: (containerId, watermark) =>
          documentReadModel.saveContainerDocumentWatermark(
            containerId,
            watermark,
          ),
        upsertDiscoveredDocuments: (inputs) =>
          documentReadModel.upsertDiscoveredDocuments(inputs),
      });
      if (!discoveredDocumentSummaries) {
        setRefreshError("Failed to refresh documents.");
        return false;
      }

      mergeDocumentSummaries(discoveredDocumentSummaries);
      primeDiscoveredDocuments(discoveredDocumentSummaries);
      return true;
    })()
      .catch((error: unknown) => {
        if (!isDestroyedDatabaseWorkerError(error)) {
          console.error("Failed to refresh explorer:", error);
          setRefreshError("Failed to refresh explorer.");
        }
        return false;
      })
      .finally(() => {
        if (refreshPromiseRef.current === refreshPromise) {
          refreshPromiseRef.current = null;
          setIsRefreshing(false);
        }
      });

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [
    applyContainerDocumentTombstones,
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
    refreshDocuments,
  ]);

  return { handleRefresh, isRefreshing, refreshError };
}
