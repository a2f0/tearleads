import type { ContainerContents, DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useRef, useState } from "react";
import { isDestroyedDatabaseWorkerError } from "./documentRuntime";

export function useExplorerRefreshAction(params: {
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: () => void;
  primeDiscoveredDocuments: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  refresh: () => Promise<boolean>;
  refreshDocuments: ContainerContents["refreshDocuments"];
}) {
  const {
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
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

      const discoveredDocumentSummaries = await refreshDocuments();
      if (!discoveredDocumentSummaries) {
        setRefreshError("Failed to refresh documents.");
        return false;
      }

      if (discoveredDocumentSummaries.length > 0) {
        mergeDocumentSummaries(discoveredDocumentSummaries);
        onDocumentLinksChanged();
        primeDiscoveredDocuments(discoveredDocumentSummaries);
      }
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
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
    refresh,
    refreshDocuments,
  ]);

  return { handleRefresh, isRefreshing, refreshError };
}
