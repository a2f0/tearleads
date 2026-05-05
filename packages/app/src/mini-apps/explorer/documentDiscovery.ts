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

interface DocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

interface DiscoverContainerDocumentsOptions {
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
  tombstones: ExplorerListContainerDocumentsResponse["tombstones"][number][];
}

async function listAllContainerDocuments(input: {
  containerId: string;
  loadContainerDocumentWatermark: DiscoverContainerDocumentsOptions["loadContainerDocumentWatermark"];
  listContainerDocuments: DiscoverContainerDocumentsOptions["listContainerDocuments"];
}): Promise<ListedContainerDocuments | null> {
  const items: ExplorerListedDocument[] = [];
  const tombstones: ExplorerListContainerDocumentsResponse["tombstones"][number][] =
    [];
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
  if (listedDocuments.tombstones.length > 0 || !listedDocuments.nextWatermark) {
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

export async function discoverContainerDocuments({
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

  await saveAppliedContainerDocumentWatermark({
    containerId,
    listedDocuments,
    saveContainerDocumentWatermark,
  });

  return discoveredDocuments;
}

export async function discoverAllContainerDocuments({
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
  const uniqueContainerIds = Array.from(new Set(containerIds));
  const listedDocumentsByContainer = await Promise.all(
    uniqueContainerIds.map(async (containerId) => ({
      containerId,
      listedDocuments: await listAllContainerDocuments({
        containerId,
        loadContainerDocumentWatermark,
        listContainerDocuments,
      }),
    })),
  );
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

  return discoveredDocuments;
}
