import { isContainerNotFoundFailure } from "../../data/containers/shared/mutationFailures";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerDocumentTombstone,
  DiscoverContainerDocumentsOptions,
  ListedContainerDocument,
  ListedContainerDocuments,
} from "./documentDiscoveryTypes";

type ContainerDocumentListApi = Pick<
  ContainerDocumentDiscoveryApi,
  "listContainerDocuments" | "listContainerDocumentsResult"
>;

function isUnavailableContainerDocumentLane(
  failure: Awaited<
    ReturnType<
      NonNullable<ContainerDocumentDiscoveryApi["listContainerDocumentsResult"]>
    >
  >,
): boolean {
  return !failure.ok && isContainerNotFoundFailure(failure);
}

export async function listContainerDocumentsFromApi(
  apiClient: ContainerDocumentListApi,
  containerId: string,
  options?: Parameters<
    ContainerDocumentDiscoveryApi["listContainerDocuments"]
  >[1],
  reportErrors = true,
): ReturnType<ContainerDocumentDiscoveryApi["listContainerDocuments"]> {
  if (apiClient.listContainerDocumentsResult) {
    const result = await apiClient.listContainerDocumentsResult(
      containerId,
      options,
      { reportErrors: false },
    );
    if (result.ok) {
      return result.data;
    }
    if (reportErrors && !isUnavailableContainerDocumentLane(result)) {
      result.report();
    }
    return null;
  }

  return apiClient.listContainerDocuments(containerId, options);
}

export async function listAllContainerDocuments(input: {
  containerId: string;
  loadContainerDocumentWatermark: DiscoverContainerDocumentsOptions["loadContainerDocumentWatermark"];
  listContainerDocuments: DiscoverContainerDocumentsOptions["listContainerDocuments"];
}): Promise<ListedContainerDocuments | null> {
  const items: ListedContainerDocument[] = [];
  const tombstones: ContainerDocumentTombstone[] = [];
  let watermark = await input.loadContainerDocumentWatermark(input.containerId);

  while (true) {
    const response = await input.listContainerDocuments(input.containerId, {
      watermark,
    });
    if (!response) {
      return null;
    }
    items.push(...response.items);
    tombstones.push(...response.tombstones);
    watermark = response.nextWatermark;

    if (!response.hasMore) {
      return { items, nextWatermark: watermark, tombstones };
    }
    if (!watermark) {
      return null;
    }
  }
}

/** Lists the authoritative current ids by deliberately starting at no watermark. */
export async function listAllContainerDocumentIdsFromApi(input: {
  readonly apiClient: ContainerDocumentListApi;
  readonly containerId: string;
  readonly reportErrors?: boolean;
}): Promise<ReadonlyArray<string> | null> {
  const listed = await listAllContainerDocuments({
    containerId: input.containerId,
    loadContainerDocumentWatermark: async () => null,
    listContainerDocuments: (containerId, options) =>
      listContainerDocumentsFromApi(
        input.apiClient,
        containerId,
        options,
        input.reportErrors,
      ),
  });
  return listed
    ? Array.from(new Set(listed.items.map((document) => document.id)))
    : null;
}
