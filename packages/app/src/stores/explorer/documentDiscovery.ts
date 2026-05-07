import type {
  ReferencedPrincipalStateResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documents/shared/documentSummary";

interface ExplorerListedDocument {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
  updatedAt: string;
}

interface ExplorerListContainerDocumentsResponse {
  hasMore: boolean;
  items: ExplorerListedDocument[];
  nextWatermark: SyncWatermark | null;
  tombstones: ReadonlyArray<{
    containerId: string;
    documentId: string;
    updatedAt: string;
  }>;
}

interface ExplorerListedContainer {
  id: string;
}

interface ExplorerListContainersResponse {
  hasMore: boolean;
  items: ExplorerListedContainer[];
  nextWatermark: SyncWatermark | null;
}

interface DocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

type ContainerDocumentTombstone =
  ExplorerListContainerDocumentsResponse["tombstones"][number];

interface DiscoverContainerDocumentsOptions {
  applyContainerDocumentTombstones: (
    tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
  cacheReferencedPrincipalPolicies?: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse>,
  ) => Promise<void>;
  containerId: string;
  loadContainerDocumentWatermark: (
    containerId: string,
  ) => Promise<SyncWatermark | null>;
  listContainerDocuments: (
    containerId: string,
    options?: { watermark?: SyncWatermark | null },
  ) => Promise<ExplorerListContainerDocumentsResponse | null>;
  replaceDocumentLinksBatch: (
    inputs: ReadonlyArray<DocumentLinkInput>,
  ) => Promise<void>;
  saveContainerDocumentWatermark: (
    containerId: string,
    watermark: SyncWatermark,
  ) => Promise<void>;
  upsertDiscoveredDocuments: (
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
}

interface ListedContainerDocuments {
  items: ExplorerListedDocument[];
  nextWatermark: SyncWatermark | null;
  tombstones: ContainerDocumentTombstone[];
}

const CONTAINER_DOCUMENT_DISCOVERY_CONCURRENCY = 4;

async function listAllContainerDocuments(input: {
  containerId: string;
  loadContainerDocumentWatermark: DiscoverContainerDocumentsOptions["loadContainerDocumentWatermark"];
  listContainerDocuments: DiscoverContainerDocumentsOptions["listContainerDocuments"];
}): Promise<ListedContainerDocuments | null> {
  const items: ExplorerListedDocument[] = [];
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

function getApplicableDocumentTombstones(
  listedDocuments: ListedContainerDocuments,
): ContainerDocumentTombstone[] {
  const latestItemsByDocumentId = new Map<string, ExplorerListedDocument>();
  for (const document of listedDocuments.items) {
    const existingDocument = latestItemsByDocumentId.get(document.id);
    if (
      !existingDocument ||
      existingDocument.updatedAt.localeCompare(document.updatedAt) < 0
    ) {
      latestItemsByDocumentId.set(document.id, document);
    }
  }

  return listedDocuments.tombstones.filter((tombstone) => {
    const item = latestItemsByDocumentId.get(tombstone.documentId);
    return (
      !item ||
      !item.linkedContainerIds.includes(tombstone.containerId) ||
      item.updatedAt.localeCompare(tombstone.updatedAt) < 0
    );
  });
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

interface DiscoverAllContainerDocumentsOptions
  extends Omit<DiscoverContainerDocumentsOptions, "containerId"> {
  containerIds: ReadonlyArray<string>;
}

async function listContainerDocumentLanes(input: {
  containerIds: ReadonlyArray<string>;
  loadContainerDocumentWatermark: DiscoverContainerDocumentsOptions["loadContainerDocumentWatermark"];
  listContainerDocuments: DiscoverContainerDocumentsOptions["listContainerDocuments"];
}): Promise<
  Array<{
    containerId: string;
    listedDocuments: ListedContainerDocuments | null;
  }>
> {
  const {
    containerIds,
    loadContainerDocumentWatermark,
    listContainerDocuments,
  } = input;
  const listedDocumentsByContainer: Array<{
    containerId: string;
    listedDocuments: ListedContainerDocuments | null;
  }> = [];
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

export async function listAllRemoteExplorerContainerIds(
  listContainers: (options: {
    parentId: string | null;
    watermark?: SyncWatermark | null;
  }) => Promise<ExplorerListContainersResponse | null>,
): Promise<ReadonlyArray<string> | null> {
  const containerIds: string[] = [];
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

    const response = await listContainers({
      parentId: lane.parentId,
      watermark: lane.watermark,
    });
    if (!response) {
      return null;
    }

    for (const container of response.items) {
      if (!seenContainerIds.has(container.id)) {
        seenContainerIds.add(container.id);
        containerIds.push(container.id);
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

  return containerIds;
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
    listedDocuments.items.flatMap(
      (document) => document.referencedPrincipals ?? [],
    ),
  );

  await replaceDocumentLinksBatch(
    listedDocuments.items.map((document) => ({
      documentId: document.id,
      containerIds: document.linkedContainerIds,
    })),
  );

  const discoveredDocuments = await upsertDiscoveredDocuments(
    listedDocuments.items.map((document) => ({
      accessEpoch: document.currentAccessEpoch,
      accessStateHash: document.currentAccessStateHash,
      containerId,
      createdAt: document.createdAt,
      documentId: document.id,
      linkedContainerIds: document.linkedContainerIds,
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
    listedDocumentsByContainer.flatMap(
      ({ listedDocuments }) =>
        listedDocuments?.items.flatMap(
          (document) => document.referencedPrincipals ?? [],
        ) ?? [],
    ),
  );
  const documentLinks: DocumentLinkInput[] = [];
  const discoveredDocumentInputs: DiscoveredDocumentInput[] = [];

  for (const { containerId, listedDocuments } of listedDocumentsByContainer) {
    if (!listedDocuments) {
      continue;
    }

    for (const document of listedDocuments.items) {
      documentLinks.push({
        documentId: document.id,
        containerIds: document.linkedContainerIds,
      });
      discoveredDocumentInputs.push({
        accessEpoch: document.currentAccessEpoch,
        accessStateHash: document.currentAccessStateHash,
        containerId,
        createdAt: document.createdAt,
        documentId: document.id,
        linkedContainerIds: document.linkedContainerIds,
      });
    }
  }

  await replaceDocumentLinksBatch(documentLinks);

  const discoveredDocuments =
    discoveredDocumentInputs.length === 0
      ? []
      : await upsertDiscoveredDocuments(discoveredDocumentInputs);
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
