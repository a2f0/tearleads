import {
  hasUndiscoveredDocumentUpdateEvent,
  discoverAllContainerDocumentsFromApi as runDiscoverAllContainerDocuments,
  discoverContainerDocumentsFromApi as runDiscoverContainerDocuments,
  listAllRemoteExplorerContainerIdsFromApi as runListAllRemoteExplorerContainerIds,
} from "../../workflows/explorer";

type ListAllRemoteExplorerContainerIdsInput = Parameters<
  typeof runListAllRemoteExplorerContainerIds
>[0];
type DiscoverContainerDocumentsInput = Parameters<
  typeof runDiscoverContainerDocuments
>[0];
type DiscoverAllContainerDocumentsInput = Parameters<
  typeof runDiscoverAllContainerDocuments
>[0];

export { hasUndiscoveredDocumentUpdateEvent };

export function listAllRemoteExplorerContainerIds(
  apiClient: ListAllRemoteExplorerContainerIdsInput,
): ReturnType<typeof runListAllRemoteExplorerContainerIds> {
  return runListAllRemoteExplorerContainerIds(apiClient);
}

export function discoverContainerDocuments(
  input: DiscoverContainerDocumentsInput,
): ReturnType<typeof runDiscoverContainerDocuments> {
  return runDiscoverContainerDocuments(input);
}

export function discoverAllContainerDocuments(
  input: DiscoverAllContainerDocumentsInput,
): ReturnType<typeof runDiscoverAllContainerDocuments> {
  return runDiscoverAllContainerDocuments(input);
}
