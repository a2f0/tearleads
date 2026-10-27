import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { isDocumentUpdateCreatedEvent } from "../../../data/documents/documentSync";
import { dedupeReferencedPrincipalStates } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyCache";
import { withoutDeferredDocumentLinks } from "../documentLinks/deferredDocumentLinks";
import { settleContainerDocumentTombstones } from "../tombstones/documentTombstoneGate";
import {
  listContainerDocumentLanesFromApi,
  listContainerDocumentsFromWatermarks,
} from "./containerDocumentListing";
import { saveAppliedContainerDocumentWatermark } from "./documentDiscoveryApply";
import {
  collectApplicableDocumentTombstones,
  collectDiscoveredDocumentInputs,
} from "./documentDiscoveryInputs";
import { discoverContainerDocumentLanes } from "./documentDiscoveryLanes";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerParentDiscoveryLane,
  DiscoverAllContainerDocumentsOptions,
  DiscoverContainerDocumentsOptions,
  ListedContainerDocumentsLane,
  RefreshAllContainerDocumentsFromApiOptions,
  RefreshAllContainerDocumentsOptions,
} from "./documentDiscoveryTypes";

export type { RefreshAllContainerDocumentsFromApiOptions } from "./documentDiscoveryTypes";

const CONTAINER_PARENT_DISCOVERY_BATCH_SIZE = 4;

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

export async function discoverContainerDocuments({
  beginDocumentDiscovery,
  listContainerDocumentLanes,
  loadContainerDocumentWatermark,
  ...lane
}: DiscoverContainerDocumentsOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  const [outcome] = await discoverContainerDocumentLanes({
    generation: await beginDocumentDiscovery(),
    lanes: [lane],
    listContainerDocumentLanes,
    loadContainerDocumentWatermark,
  });
  if (outcome?.status === "rejected") throw outcome.reason;
  return outcome?.value ?? null;
}

export function discoverContainerDocumentsFromApi({
  apiClient,
  ...input
}: Omit<DiscoverContainerDocumentsOptions, "listContainerDocumentLanes"> & {
  readonly apiClient: Pick<
    ContainerDocumentDiscoveryApi,
    "listContainerDocumentLanes"
  >;
}): Promise<ReadonlyArray<DocumentSummary> | null> {
  return discoverContainerDocuments({
    ...input,
    listContainerDocumentLanes: (lanes) =>
      listContainerDocumentLanesFromApi(apiClient, lanes),
  });
}

async function listDiscoveryLanes(
  input: Parameters<typeof listContainerDocumentsFromWatermarks>[0],
): Promise<ListedContainerDocumentsLane[]> {
  const listed = await listContainerDocumentsFromWatermarks(input);
  return input.containerIds.map((containerId) => ({
    containerId,
    listedDocuments: listed.get(containerId) ?? null,
  }));
}

async function saveListedWatermarks(
  lanes: readonly ListedContainerDocumentsLane[],
  saveContainerDocumentWatermark: DiscoverContainerDocumentsOptions["saveContainerDocumentWatermark"],
  stillCurrent: () => Promise<boolean>,
): Promise<void> {
  await Promise.all(
    lanes.map(({ containerId, listedDocuments }) =>
      listedDocuments
        ? saveAppliedContainerDocumentWatermark({
            containerId,
            listedDocuments,
            saveContainerDocumentWatermark,
            stillCurrent,
          })
        : undefined,
    ),
  );
}

export async function discoverAllContainerDocuments(
  options: DiscoverAllContainerDocumentsOptions,
): Promise<ReadonlyArray<DocumentSummary> | null> {
  const {
    cacheReferencedPrincipalPolicies,
    containerIds,
    loadContainerDocumentWatermark,
    listContainerDocumentLanes,
    replaceDocumentLinksBatch,
    saveContainerDocumentWatermark,
    upsertDiscoveredDocuments,
  } = options;
  const uniqueContainerIds = Array.from(new Set(containerIds)).filter(
    (containerId): containerId is string =>
      typeof containerId === "string" && containerId.length > 0,
  );
  const generation = await options.beginDocumentDiscovery();
  const listedDocumentsByContainer = await listDiscoveryLanes({
    containerIds: uniqueContainerIds,
    listContainerDocumentLanes,
    loadContainerDocumentWatermark,
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
      : await upsertDiscoveredDocuments(
          discoveredDocumentInputs,
          verification.isCurrent,
        );

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
      verification.isCurrent,
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

  await saveListedWatermarks(
    listedDocumentsByContainer,
    saveContainerDocumentWatermark,
    verification.isCurrent,
  );
  if (!(await verification.isCurrent())) return null;

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
    listContainerDocumentLanes: (lanes) =>
      listContainerDocumentLanesFromApi(apiClient, lanes),
    listContainerParentLanes: (input) =>
      apiClient.listContainerParentLanes(input),
  });
}
