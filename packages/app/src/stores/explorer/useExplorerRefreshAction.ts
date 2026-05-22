import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import {
  discoverAllContainerDocumentsFromApi,
  listAllRemoteContainerIdsFromApi as listAllRemoteExplorerContainerIdsFromApi,
} from "@tearleads/client-sdk/workflows/container-documents";
import { useCallback, useRef, useState } from "react";
import type { useAppData } from "../../providers/data/AppDataProvider";
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
  appData: Pick<
    ReturnType<typeof useAppData>,
    "apiClient" | "cacheReferencedPrincipalPolicies"
  >;
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
}) {
  const {
    appData,
    applyContainerDocumentTombstones,
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  } = params;
  const { apiClient, cacheReferencedPrincipalPolicies } = appData;
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

      const remoteContainerIds =
        await listAllRemoteExplorerContainerIdsFromApi(apiClient);
      if (!remoteContainerIds) {
        setRefreshError("Failed to refresh documents.");
        return false;
      }

      const discoveredDocumentSummaries =
        await discoverAllContainerDocumentsFromApi({
          apiClient,
          applyContainerDocumentTombstones,
          cacheReferencedPrincipalPolicies,
          containerIds: remoteContainerIds,
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
    apiClient,
    applyContainerDocumentTombstones,
    cacheReferencedPrincipalPolicies,
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  ]);

  return { handleRefresh, isRefreshing, refreshError };
}
