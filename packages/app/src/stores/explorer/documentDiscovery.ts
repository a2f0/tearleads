import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import {
  hasUndiscoveredDocumentUpdateEvent,
  discoverAllContainerDocuments as runDiscoverAllContainerDocuments,
  discoverContainerDocuments as runDiscoverContainerDocuments,
  listAllRemoteExplorerContainerIds as runListAllRemoteExplorerContainerIds,
} from "../../workflows/explorer";

type ExplorerDocumentDiscoveryApi = Pick<
  AppDataContextValue["apiClient"],
  "listContainerDocuments" | "listContainers"
>;

type DiscoverContainerDocumentsInput = Omit<
  Parameters<typeof runDiscoverContainerDocuments>[0],
  "listContainerDocuments"
> & {
  apiClient: Pick<ExplorerDocumentDiscoveryApi, "listContainerDocuments">;
};

type DiscoverAllContainerDocumentsInput = Omit<
  Parameters<typeof runDiscoverAllContainerDocuments>[0],
  "listContainerDocuments"
> & {
  apiClient: Pick<ExplorerDocumentDiscoveryApi, "listContainerDocuments">;
};

export { hasUndiscoveredDocumentUpdateEvent };

export function listAllRemoteExplorerContainerIds(
  apiClient: Pick<ExplorerDocumentDiscoveryApi, "listContainers">,
): ReturnType<typeof runListAllRemoteExplorerContainerIds> {
  return runListAllRemoteExplorerContainerIds((options) =>
    apiClient.listContainers(options),
  );
}

export function discoverContainerDocuments({
  apiClient,
  ...input
}: DiscoverContainerDocumentsInput): ReturnType<
  typeof runDiscoverContainerDocuments
> {
  return runDiscoverContainerDocuments({
    ...input,
    listContainerDocuments: (containerId, options) =>
      apiClient.listContainerDocuments(containerId, options),
  });
}

export function discoverAllContainerDocuments({
  apiClient,
  ...input
}: DiscoverAllContainerDocumentsInput): ReturnType<
  typeof runDiscoverAllContainerDocuments
> {
  return runDiscoverAllContainerDocuments({
    ...input,
    listContainerDocuments: (containerId, options) =>
      apiClient.listContainerDocuments(containerId, options),
  });
}
