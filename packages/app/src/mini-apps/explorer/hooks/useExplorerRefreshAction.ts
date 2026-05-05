import { useCallback, useState } from "react";
import type { DocumentSummary } from "../../../data/documents/shared/documentSummary";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import {
  type ExplorerDocumentLinkInput,
  upsertDiscoveredExplorerDocuments,
} from "../../../stores/explorer/documentReadModel";
import { isDestroyedDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { discoverAllContainerDocuments } from "../documentDiscovery";

type ReplaceDocumentLinksBatch = (
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
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

  const handleRefresh = useCallback(async (): Promise<boolean> => {
    setRefreshError(null);
    setIsRefreshing(true);

    try {
      const refreshed = await refresh();
      if (!refreshed) {
        setRefreshError("Refresh unavailable.");
        return false;
      }

      const remoteContainers = await apiClient.listContainers();
      if (!remoteContainers) {
        setRefreshError("Failed to refresh documents.");
        return false;
      }

      const discoveredDocumentSummaries = await discoverAllContainerDocuments({
        cacheReferencedPrincipalPolicies,
        containerIds: remoteContainers.map((container) => container.id),
        listContainerDocuments: (containerId) =>
          apiClient.listContainerDocuments(containerId),
        replaceDocumentLinksBatch,
        upsertDiscoveredDocuments: (inputs) =>
          upsertDiscoveredExplorerDocuments(execSql, inputs),
      });

      mergeDocumentSummaries(discoveredDocumentSummaries);
      primeDiscoveredDocuments(discoveredDocumentSummaries);
      return true;
    } catch (error: unknown) {
      if (!isDestroyedDatabaseWorkerError(error)) {
        console.error("Failed to refresh explorer:", error);
        setRefreshError("Failed to refresh explorer.");
      }
      return false;
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
