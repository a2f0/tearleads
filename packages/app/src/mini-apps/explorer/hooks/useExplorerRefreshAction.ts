import type { ContainerSummary } from "@tearleads/validators/response";
import { useCallback, useState } from "react";
import type { DocumentSummary } from "../../../data/documents/shared/documentSummary";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import type {
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "../../../stores/explorer/documentReadModel";
import { isDestroyedDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { discoverAllContainerDocuments } from "../documentDiscovery";

type ReplaceDocumentLinksBatch = (
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
) => Promise<void>;

async function listAllRemoteContainers(
  apiClient: ReturnType<typeof useAppData>["apiClient"],
): Promise<ReadonlyArray<ContainerSummary> | null> {
  const containers: ContainerSummary[] = [];

  for (let depth = 0; ; depth += 1) {
    let cursor: string | null = null;
    let depthChangeCount = 0;

    do {
      const response = await apiClient.listContainers({ cursor, depth });
      if (!response) {
        return null;
      }
      if (Array.isArray(response)) {
        containers.push(...response);
        return containers;
      }
      const normalizedResponse = response;

      containers.push(...normalizedResponse.items);
      depthChangeCount +=
        normalizedResponse.items.length + normalizedResponse.tombstones.length;
      cursor = normalizedResponse.nextCursor;

      if (!normalizedResponse.hasMore) {
        break;
      }
    } while (cursor);

    if (depthChangeCount === 0) {
      break;
    }
  }

  return containers;
}

export function useExplorerRefreshAction(params: {
  appData: Pick<
    ReturnType<typeof useAppData>,
    "apiClient" | "cacheReferencedPrincipalPolicies"
  >;
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
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  } = params;
  const { apiClient, cacheReferencedPrincipalPolicies } = appData;
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

      const remoteContainers = await listAllRemoteContainers(apiClient);
      if (!remoteContainers) {
        setRefreshError("Failed to refresh documents.");
        return false;
      }

      const discoveredDocumentSummaries = await discoverAllContainerDocuments({
        cacheReferencedPrincipalPolicies,
        containerIds: remoteContainers.map((container) => container.id),
        listContainerDocuments: (containerId, options) =>
          apiClient.listContainerDocuments(containerId, options),
        replaceDocumentLinksBatch,
        upsertDiscoveredDocuments: (inputs) =>
          documentReadModel.upsertDiscoveredDocuments(inputs),
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
    documentReadModel,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh,
  ]);

  return { handleRefresh, isRefreshing, refreshError };
}
