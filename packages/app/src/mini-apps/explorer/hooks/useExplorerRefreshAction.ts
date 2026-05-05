import type {
  ContainerSummary,
  SyncWatermark,
} from "@tearleads/validators/response";
import { useCallback, useState } from "react";
import type { DocumentSummary } from "../../../data/documents/shared/documentSummary";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import type {
  ExplorerContainerDocumentTombstone,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "../../../stores/explorer/documentReadModel";
import { isDestroyedDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import { discoverAllContainerDocuments } from "../documentDiscovery";

type ReplaceDocumentLinksBatch = (
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
) => Promise<void>;

type ApplyContainerDocumentTombstones = (
  tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>,
) => Promise<ReadonlyArray<DocumentSummary>>;

async function listAllRemoteContainers(
  apiClient: ReturnType<typeof useAppData>["apiClient"],
): Promise<ReadonlyArray<ContainerSummary> | null> {
  const containers: ContainerSummary[] = [];
  const queuedParentIds = new Set<string>(["root"]);
  const seenContainerIds = new Set<string>();
  const lanes: Array<{
    parentId: string | null;
    watermark: SyncWatermark | null;
  }> = [{ parentId: null, watermark: null }];

  while (lanes.length > 0) {
    const lane = lanes.shift();
    if (!lane) {
      break;
    }

    const response = await apiClient.listContainers({
      parentId: lane.parentId,
      watermark: lane.watermark,
    });
    if (!response) {
      return null;
    }

    for (const container of response.items) {
      if (!seenContainerIds.has(container.id)) {
        seenContainerIds.add(container.id);
        containers.push(container);
      }

      if (!queuedParentIds.has(container.id)) {
        queuedParentIds.add(container.id);
        lanes.push({ parentId: container.id, watermark: null });
      }
    }

    if (response.hasMore) {
      if (!response.nextWatermark) {
        return null;
      }
      lanes.unshift({
        parentId: lane.parentId,
        watermark: response.nextWatermark,
      });
    }
  }

  return containers;
}

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
        applyContainerDocumentTombstones,
        cacheReferencedPrincipalPolicies,
        containerIds: remoteContainers.map((container) => container.id),
        loadContainerDocumentWatermark: (containerId) =>
          documentReadModel.loadContainerDocumentWatermark(containerId),
        listContainerDocuments: (containerId, options) =>
          apiClient.listContainerDocuments(containerId, options),
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
