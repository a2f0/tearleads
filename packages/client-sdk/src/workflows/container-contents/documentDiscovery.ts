import type { DocumentSummary } from "../../data/documentSummary";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import {
  collectDiscoveredDocumentInputs,
  getApplicableDocumentTombstones,
  uniqueReferencedPrincipalStates,
} from "./documentDiscoveryInputs";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerDocumentTombstone,
  ContainerParentDiscoveryLane,
  DiscoverAllContainerDocumentsOptions,
  DiscoverContainerDocumentsOptions,
  ListedContainerDocument,
  ListedContainerDocuments,
  ListedContainerDocumentsLane,
  RefreshAllContainerDocumentsFromApiOptions,
  RefreshAllContainerDocumentsOptions,
} from "./documentDiscoveryTypes";

export type { RefreshAllContainerDocumentsFromApiOptions } from "./documentDiscoveryTypes";

const CONTAINER_PARENT_DISCOVERY_CONCURRENCY = 4;
const CONTAINER_DOCUMENT_DISCOVERY_CONCURRENCY = 4;

function isUnavailableContainerDocumentLane(
  failure: Awaited<
    ReturnType<
      NonNullable<ContainerDocumentDiscoveryApi["listContainerDocumentsResult"]>
    >
  >,
): boolean {
  return !failure.ok && failure.status === 404;
}

async function listContainerDocumentsFromApi(
  apiClient: Pick<
    ContainerDocumentDiscoveryApi,
    "listContainerDocuments" | "listContainerDocumentsResult"
  >,
  containerId: string,
  options?: Parameters<
    ContainerDocumentDiscoveryApi["listContainerDocuments"]
  >[1],
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
    if (!isUnavailableContainerDocumentLane(result)) {
      result.report();
    }
    return null;
  }

  return apiClient.listContainerDocuments(containerId, options);
}

async function listAllContainerDocuments(input: {
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
      return {
        items,
        nextWatermark: watermark,
        tombstones,
      };
    }

    if (!watermark) {
      return null;
    }
  }
}

async function saveAppliedContainerDocumentWatermark(input: {
  containerId: string;
  listedDocuments: ListedContainerDocuments;
  saveContainerDocumentWatermark: DiscoverContainerDocumentsOptions["saveContainerDocumentWatermark"];
}) {
  const { containerId, listedDocuments, saveContainerDocumentWatermark } =
    input;
  if (!listedDocuments.nextWatermark) {
    return;
  }

  await saveContainerDocumentWatermark(
    containerId,
    listedDocuments.nextWatermark,
  );
}

async function listContainerDocumentLanes(input: {
  containerIds: ReadonlyArray<string>;
  loadContainerDocumentWatermark: DiscoverContainerDocumentsOptions["loadContainerDocumentWatermark"];
  listContainerDocuments: DiscoverContainerDocumentsOptions["listContainerDocuments"];
}): Promise<ListedContainerDocumentsLane[]> {
  const {
    containerIds,
    loadContainerDocumentWatermark,
    listContainerDocuments,
  } = input;
  const listedDocumentsByContainer: ListedContainerDocumentsLane[] = [];
  let nextContainerIndex = 0;

  async function worker() {
    while (nextContainerIndex < containerIds.length) {
      const containerIndex = nextContainerIndex;
      nextContainerIndex += 1;
      const containerId = containerIds[containerIndex];
      if (!containerId) {
        throw new Error("Container document discovery received an empty lane");
      }

      listedDocumentsByContainer[containerIndex] = {
        containerId,
        listedDocuments: await listAllContainerDocuments({
          containerId,
          loadContainerDocumentWatermark,
          listContainerDocuments,
        }),
      };
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          CONTAINER_DOCUMENT_DISCOVERY_CONCURRENCY,
          containerIds.length,
        ),
      },
      () => worker(),
    ),
  );

  return listedDocumentsByContainer;
}

export function hasUndiscoveredDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  knownDocumentIds: ReadonlySet<string>,
): boolean {
  return events.some(
    (event) =>
      isDocumentUpdateCreatedEvent(event) &&
      !knownDocumentIds.has(event.documentId),
  );
}

export async function listAllRemoteContainerIds(
  listContainers: ContainerDocumentDiscoveryApi["listContainers"],
): Promise<ReadonlyArray<string> | null> {
  const containerIds: string[] = [];
  const queuedParentIds = new Set<string | null>();
  const seenContainerIds = new Set<string>();
  const lanes: ContainerParentDiscoveryLane[] = [];
  const queueParentLane = (parentId: string | null) => {
    if (queuedParentIds.has(parentId)) {
      return;
    }

    queuedParentIds.add(parentId);
    lanes.push({ parentId, watermark: null });
  };

  queueParentLane(null);

  while (lanes.length > 0) {
    const laneBatch = lanes.splice(0, CONTAINER_PARENT_DISCOVERY_CONCURRENCY);
    const listedLanes = await Promise.all(
      laneBatch.map(async (lane) => ({
        lane,
        response: await listContainers({
          parentId: lane.parentId,
          watermark: lane.watermark,
        }),
      })),
    );
    const continuationLanes: ContainerParentDiscoveryLane[] = [];

    for (const { lane, response } of listedLanes) {
      if (!response) {
        return null;
      }

      for (const container of response.items) {
        if (!seenContainerIds.has(container.id)) {
          seenContainerIds.add(container.id);
          containerIds.push(container.id);
        }

        queueParentLane(container.id);
      }

      if (response.hasMore) {
        if (!response.nextWatermark) {
          return null;
        }
        continuationLanes.push({
          parentId: lane.parentId,
          watermark: response.nextWatermark,
        });
      }
    }

    lanes.unshift(...continuationLanes);
  }

  return containerIds;
}

export function listAllRemoteContainerIdsFromApi(
  apiClient: Pick<ContainerDocumentDiscoveryApi, "listContainers">,
): Promise<ReadonlyArray<string> | null> {
  return listAllRemoteContainerIds((options) =>
    apiClient.listContainers(options),
  );
}

export async function discoverContainerDocuments({
  applyContainerDocumentTombstones,
  cacheReferencedPrincipalPolicies,
  containerId,
  loadContainerDocumentWatermark,
  listContainerDocuments,
  replaceDocumentLinksBatch,
  saveContainerDocumentWatermark,
  upsertDiscoveredDocuments,
}: DiscoverContainerDocumentsOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  const listedDocuments = await listAllContainerDocuments({
    containerId,
    loadContainerDocumentWatermark,
    listContainerDocuments,
  });
  if (!listedDocuments) {
    return null;
  }

  await cacheReferencedPrincipalPolicies?.(
    uniqueReferencedPrincipalStates(
      listedDocuments.items.flatMap(
        (document) => document.referencedPrincipals,
      ),
    ),
  );

  const discoveredDocuments = await upsertDiscoveredDocuments(
    listedDocuments.items.map((document) => ({
      accessEpoch: document.currentAccessEpoch,
      accessStateHash: document.currentAccessStateHash,
      containerId,
      createdAt: document.createdAt,
      documentId: document.id,
      effectiveAccessLevel: document.effectiveAccessLevel,
      linkedContainerIds: document.linkedContainerIds,
    })),
  );

  await replaceDocumentLinksBatch(
    listedDocuments.items.map((document) => ({
      documentId: document.id,
      containerIds: document.linkedContainerIds,
    })),
  );

  const tombstoneDocumentSummaries = await applyContainerDocumentTombstones(
    getApplicableDocumentTombstones(listedDocuments),
  );

  await saveAppliedContainerDocumentWatermark({
    containerId,
    listedDocuments,
    saveContainerDocumentWatermark,
  });

  return [...discoveredDocuments, ...tombstoneDocumentSummaries];
}

export function discoverContainerDocumentsFromApi({
  apiClient,
  ...input
}: Omit<DiscoverContainerDocumentsOptions, "listContainerDocuments"> & {
  readonly apiClient: Pick<
    ContainerDocumentDiscoveryApi,
    "listContainerDocuments" | "listContainerDocumentsResult"
  >;
}): Promise<ReadonlyArray<DocumentSummary> | null> {
  return discoverContainerDocuments({
    ...input,
    listContainerDocuments: (containerId, options) =>
      listContainerDocumentsFromApi(apiClient, containerId, options),
  });
}

export async function discoverAllContainerDocuments({
  applyContainerDocumentTombstones,
  cacheReferencedPrincipalPolicies,
  containerIds,
  loadContainerDocumentWatermark,
  listContainerDocuments,
  replaceDocumentLinksBatch,
  saveContainerDocumentWatermark,
  upsertDiscoveredDocuments,
}: DiscoverAllContainerDocumentsOptions): Promise<
  ReadonlyArray<DocumentSummary>
> {
  const uniqueContainerIds = Array.from(new Set(containerIds)).filter(
    (containerId): containerId is string =>
      typeof containerId === "string" && containerId.length > 0,
  );
  const listedDocumentsByContainer = await listContainerDocumentLanes({
    containerIds: uniqueContainerIds,
    loadContainerDocumentWatermark,
    listContainerDocuments,
  });
  await cacheReferencedPrincipalPolicies?.(
    uniqueReferencedPrincipalStates(
      listedDocumentsByContainer.flatMap(
        ({ listedDocuments }) =>
          listedDocuments?.items.flatMap(
            (document) => document.referencedPrincipals,
          ) ?? [],
      ),
    ),
  );
  const discoveredDocumentInputs = collectDiscoveredDocumentInputs(
    listedDocumentsByContainer,
  );
  const discoveredDocuments =
    discoveredDocumentInputs.length === 0
      ? []
      : await upsertDiscoveredDocuments(discoveredDocumentInputs);

  if (discoveredDocumentInputs.length > 0) {
    await replaceDocumentLinksBatch(
      discoveredDocumentInputs.map((input) => ({
        documentId: input.documentId,
        containerIds: input.linkedContainerIds,
      })),
    );
  }

  const tombstoneDocumentSummaries = await applyContainerDocumentTombstones(
    listedDocumentsByContainer.flatMap(({ listedDocuments }) =>
      listedDocuments ? getApplicableDocumentTombstones(listedDocuments) : [],
    ),
  );

  await Promise.all(
    listedDocumentsByContainer.map(({ containerId, listedDocuments }) =>
      listedDocuments
        ? saveAppliedContainerDocumentWatermark({
            containerId,
            listedDocuments,
            saveContainerDocumentWatermark,
          })
        : undefined,
    ),
  );

  return [...discoveredDocuments, ...tombstoneDocumentSummaries];
}

async function refreshAllContainerDocuments({
  listContainers,
  ...input
}: RefreshAllContainerDocumentsOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  const containerIds = await listAllRemoteContainerIds(listContainers);
  if (!containerIds) {
    return null;
  }

  return discoverAllContainerDocuments({
    ...input,
    containerIds,
  });
}

export function refreshAllContainerDocumentsFromApi({
  apiClient,
  ...input
}: RefreshAllContainerDocumentsFromApiOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  return refreshAllContainerDocuments({
    ...input,
    listContainerDocuments: (containerId, options) =>
      listContainerDocumentsFromApi(apiClient, containerId, options),
    listContainers: (options) => apiClient.listContainers(options),
  });
}
