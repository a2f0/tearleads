import type { DocumentSummary } from "../../data/documents/documentSummary";
import { isDocumentUpdateCreatedEvent } from "../../data/documents/documentSync";
import { dedupeReferencedPrincipalStates } from "../../data/keyingProjectionVerification/principalPolicyCache";
import {
  listAllContainerDocuments,
  listContainerDocumentsFromApi,
} from "./containerDocumentListing";
import { withoutDeferredDocumentLinks } from "./deferredDocumentLinks";
import {
  collectApplicableDocumentTombstones,
  collectDiscoveredDocumentInputs,
  getApplicableDocumentTombstones,
} from "./documentDiscoveryInputs";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerParentDiscoveryLane,
  DiscoverAllContainerDocumentsOptions,
  DiscoverContainerDocumentsOptions,
  ListedContainerDocuments,
  ListedContainerDocumentsLane,
  RefreshAllContainerDocumentsFromApiOptions,
  RefreshAllContainerDocumentsOptions,
} from "./documentDiscoveryTypes";
import { settleContainerDocumentTombstones } from "./documentTombstoneGate";

export type { RefreshAllContainerDocumentsFromApiOptions } from "./documentDiscoveryTypes";

const CONTAINER_PARENT_DISCOVERY_BATCH_SIZE = 4;
const CONTAINER_DOCUMENT_DISCOVERY_CONCURRENCY = 4;

type ContainerParentLaneRequest = Parameters<
  ContainerDocumentDiscoveryApi["listContainerParentLanes"]
>[0]["lanes"][number];

interface RequestedContainerParentLane {
  lane: ContainerParentDiscoveryLane;
  request: ContainerParentLaneRequest;
}

async function listContainerParentLaneBatch(
  listContainerParentLanes: ContainerDocumentDiscoveryApi["listContainerParentLanes"],
  requestedLanes: ReadonlyArray<RequestedContainerParentLane>,
) {
  const response = await listContainerParentLanes({
    lanes: requestedLanes.map(({ request }) => request),
  });
  if (!response || response.results.length !== requestedLanes.length) {
    return null;
  }

  const requestedLaneIds = new Set(
    requestedLanes.map(({ request }) => request.laneId),
  );
  const pagesByLaneId = new Map<
    string,
    (typeof response.results)[number]["page"]
  >();
  for (const result of response.results) {
    if (
      !requestedLaneIds.has(result.laneId) ||
      pagesByLaneId.has(result.laneId)
    ) {
      return null;
    }
    pagesByLaneId.set(result.laneId, result.page);
  }

  return requestedLanes.map(({ lane, request }) => ({
    lane,
    response: pagesByLaneId.get(request.laneId),
  }));
}

function collectRemoteContainerIds(
  items: ReadonlyArray<{ id: string }>,
  seenContainerIds: Set<string>,
  containerIds: string[],
): ReadonlyArray<string> {
  for (const { id } of items) {
    if (!seenContainerIds.has(id)) {
      seenContainerIds.add(id);
      containerIds.push(id);
    }
  }

  return items.map(({ id }) => id);
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
  listContainerParentLanes: ContainerDocumentDiscoveryApi["listContainerParentLanes"],
): Promise<ReadonlyArray<string> | null> {
  const containerIds: string[] = [];
  const queuedParentIds = new Set<string | null>();
  const seenContainerIds = new Set<string>();
  const lanes: ContainerParentDiscoveryLane[] = [];
  let nextLaneId = 0;
  const queueParentLane = (parentId: string | null) => {
    if (queuedParentIds.has(parentId)) {
      return;
    }

    queuedParentIds.add(parentId);
    lanes.push({ parentId, watermark: null });
  };

  queueParentLane(null);

  while (lanes.length > 0) {
    const laneBatch = lanes.splice(0, CONTAINER_PARENT_DISCOVERY_BATCH_SIZE);
    const requestedLanes = laneBatch.map((lane) => ({
      lane,
      request: {
        laneId: `container-parent-${nextLaneId++}`,
        parentId: lane.parentId,
        watermark: lane.watermark,
      },
    }));
    const listedLanes = await listContainerParentLaneBatch(
      listContainerParentLanes,
      requestedLanes,
    );
    if (!listedLanes) {
      return null;
    }
    const continuationLanes: ContainerParentDiscoveryLane[] = [];

    for (const { lane, response } of listedLanes) {
      if (!response) {
        return null;
      }

      for (const containerId of collectRemoteContainerIds(
        response.items,
        seenContainerIds,
        containerIds,
      )) {
        queueParentLane(containerId);
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
  apiClient: Pick<ContainerDocumentDiscoveryApi, "listContainerParentLanes">,
): Promise<ReadonlyArray<string> | null> {
  return listAllRemoteContainerIds((input) =>
    apiClient.listContainerParentLanes(input),
  );
}

export async function discoverContainerDocuments(
  options: DiscoverContainerDocumentsOptions,
): Promise<ReadonlyArray<DocumentSummary> | null> {
  const {
    cacheReferencedPrincipalPolicies,
    containerId,
    loadContainerDocumentWatermark,
    listContainerDocuments,
    onFullListing,
    replaceDocumentLinksBatch,
    saveContainerDocumentWatermark,
    upsertDiscoveredDocuments,
  } = options;
  const generation = await options.beginDocumentDiscovery();
  const listedDocuments = await listAllContainerDocuments({
    containerId,
    loadContainerDocumentWatermark,
    listContainerDocuments,
  });
  if (!listedDocuments) {
    return null;
  }

  await cacheReferencedPrincipalPolicies?.(
    dedupeReferencedPrincipalStates(
      listedDocuments.items.flatMap(
        (document) => document.referencedPrincipals,
      ),
    ),
  );

  const verification = await options.verifyDiscoveredDocuments(
    listedDocuments.items.map((document) => ({
      accessEpoch: document.currentAccessEpoch,
      accessStateHash: document.currentAccessStateHash,
      containerId,
      listedContainerIds: [containerId],
      createdAt: document.createdAt,
      documentId: document.id,
      effectiveAccessLevel: document.effectiveAccessLevel,
      linkedContainerIds: document.linkedContainerIds,
    })),
    [containerId],
    generation,
    getApplicableDocumentTombstones(listedDocuments),
  );
  if (!(await verification.isCurrent())) return null;
  const verifiedInputs = verification.inputs;
  const discoveredDocuments = verifiedInputs.length
    ? await upsertDiscoveredDocuments(verifiedInputs)
    : [];

  if (verifiedInputs.length)
    await replaceDocumentLinksBatch(
      await withoutDeferredDocumentLinks(
        verifiedInputs.map((document) => ({
          documentId: document.documentId,
          accessEpoch: document.accessEpoch,
          containerIds: document.linkedContainerIds,
        })),
        discoveredDocuments,
      ),
    );

  const tombstoneDocumentSummaries = await settleContainerDocumentTombstones({
    containerIds: [containerId],
    store: options,
    tombstones: getApplicableDocumentTombstones(listedDocuments),
  });

  const complete = await verification.commit();
  if (!(await verification.isCurrent())) return null;
  await saveAppliedContainerDocumentWatermark({
    containerId,
    listedDocuments,
    saveContainerDocumentWatermark,
  });

  if (listedDocuments.isFullListing) {
    // Initial probes consume ids as discovery hints and verify their own heads.
    onFullListing?.(listedDocuments.items.map((document) => document.id));
  }

  return !complete &&
    discoveredDocuments.length === 0 &&
    tombstoneDocumentSummaries.length === 0
    ? null
    : [...discoveredDocuments, ...tombstoneDocumentSummaries];
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

export async function discoverAllContainerDocuments(
  options: DiscoverAllContainerDocumentsOptions,
): Promise<ReadonlyArray<DocumentSummary> | null> {
  const {
    cacheReferencedPrincipalPolicies,
    containerIds,
    loadContainerDocumentWatermark,
    listContainerDocuments,
    replaceDocumentLinksBatch,
    saveContainerDocumentWatermark,
    upsertDiscoveredDocuments,
  } = options;
  const uniqueContainerIds = Array.from(new Set(containerIds)).filter(
    (containerId): containerId is string =>
      typeof containerId === "string" && containerId.length > 0,
  );
  const generation = await options.beginDocumentDiscovery();
  const listedDocumentsByContainer = await listContainerDocumentLanes({
    containerIds: uniqueContainerIds,
    loadContainerDocumentWatermark,
    listContainerDocuments,
  });
  await cacheReferencedPrincipalPolicies?.(
    dedupeReferencedPrincipalStates(
      listedDocumentsByContainer.flatMap(
        ({ listedDocuments }) =>
          listedDocuments?.items.flatMap(
            (document) => document.referencedPrincipals,
          ) ?? [],
      ),
    ),
  );
  const verification = await options.verifyDiscoveredDocuments(
    collectDiscoveredDocumentInputs(listedDocumentsByContainer),
    uniqueContainerIds,
    generation,
    collectApplicableDocumentTombstones(listedDocumentsByContainer),
  );
  if (!(await verification.isCurrent())) return null;
  const discoveredDocumentInputs = verification.inputs;
  const discoveredDocuments =
    discoveredDocumentInputs.length === 0
      ? []
      : await upsertDiscoveredDocuments(discoveredDocumentInputs);

  if (discoveredDocumentInputs.length > 0) {
    await replaceDocumentLinksBatch(
      await withoutDeferredDocumentLinks(
        discoveredDocumentInputs.map((input) => ({
          documentId: input.documentId,
          accessEpoch: input.accessEpoch,
          containerIds: input.linkedContainerIds,
        })),
        discoveredDocuments,
      ),
    );
  }

  const tombstoneDocumentSummaries = await settleContainerDocumentTombstones({
    containerIds: listedDocumentsByContainer.flatMap(
      ({ containerId, listedDocuments }) =>
        listedDocuments ? [containerId] : [],
    ),
    store: options,
    tombstones: collectApplicableDocumentTombstones(listedDocumentsByContainer),
  });

  const complete = await verification.commit();
  if (!(await verification.isCurrent())) return null;

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

  return !complete &&
    discoveredDocuments.length === 0 &&
    tombstoneDocumentSummaries.length === 0
    ? null
    : [...discoveredDocuments, ...tombstoneDocumentSummaries];
}

async function refreshAllContainerDocuments({
  listContainerParentLanes,
  ...input
}: RefreshAllContainerDocumentsOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  const containerIds = await listAllRemoteContainerIds(
    listContainerParentLanes,
  );
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
    listContainerParentLanes: (input) =>
      apiClient.listContainerParentLanes(input),
  });
}
