import { useCallback, useState } from "react";
import type { useAppData } from "../../../data/AppDataProvider";
import {
  type DocumentSummary,
  upsertDiscoveredDocuments,
} from "../../../data/documents/documentsPersistence";
import { discoverAllContainerDocuments } from "../documentDiscovery";
import { isDestroyedDatabaseWorkerError } from "../explorerRuntime";

type ReplaceDocumentLinksBatch = (
  inputs: ReadonlyArray<{
    containerIds: ReadonlyArray<string>;
    documentId: string;
  }>,
) => Promise<void>;

export function useExplorerRefreshAction(params: {
  appData: Pick<
    ReturnType<typeof useAppData>,
    "apiClient" | "cacheReferencedPrincipalPolicies" | "execSql"
  >;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  primeDiscoveredDocuments: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  replaceDocumentLinksBatch: ReplaceDocumentLinksBatch;
  refresh: () => Promise<boolean>;
}) {
  const {
    appData,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  } = params;
  const { apiClient, cacheReferencedPrincipalPolicies, execSql } = appData;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    setRefreshError(null);
    setIsRefreshing(true);

    try {
      const refreshed = await refresh();
      if (!refreshed) {
        setRefreshError("Refresh unavailable.");
        return;
      }

      const remoteContainers = await apiClient.listContainers();
      if (!remoteContainers) {
        setRefreshError("Failed to refresh documents.");
        return;
      }

      const discoveredDocumentSummaries = await discoverAllContainerDocuments({
        cacheReferencedPrincipalPolicies,
        containerIds: remoteContainers.map((container) => container.id),
        listContainerDocuments: (containerId) =>
          apiClient.listContainerDocuments(containerId),
        replaceDocumentLinksBatch,
        upsertDiscoveredDocuments: (inputs) =>
          upsertDiscoveredDocuments(execSql, inputs),
      });

      mergeDocumentSummaries(discoveredDocumentSummaries);
      primeDiscoveredDocuments(discoveredDocumentSummaries);
    } catch (error: unknown) {
      if (!isDestroyedDatabaseWorkerError(error)) {
        console.error("Failed to refresh explorer:", error);
        setRefreshError("Failed to refresh explorer.");
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [
    apiClient,
    cacheReferencedPrincipalPolicies,
    execSql,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  ]);

  return { handleRefresh, isRefreshing, refreshError };
}
