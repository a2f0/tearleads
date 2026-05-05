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
  updatedAt?: string;
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

function normalizeListContainerDocumentsResponse(
  response:
    | ExplorerListContainerDocumentsResponse
    | ReadonlyArray<ExplorerListedDocument>,
): ExplorerListContainerDocumentsResponse {
  if (Array.isArray(response)) {
    return {
      hasMore: false,
      items: response,
      nextWatermark: null,
      tombstones: [],
    };
  }

  return response as ExplorerListContainerDocumentsResponse;
}

interface DiscoverContainerDocumentsOptions {
  cacheReferencedPrincipalPolicies?: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse>,
  ) => Promise<void>;
  containerId: string;
  listContainerDocuments: (
    containerId: string,
    options?: { watermark?: SyncWatermark | null },
  ) => Promise<
    | ExplorerListContainerDocumentsResponse
    | ReadonlyArray<ExplorerListedDocument>
    | null
  >;
  replaceDocumentLinksBatch: (
    inputs: ReadonlyArray<DocumentLinkInput>,
  ) => Promise<void>;
  upsertDiscoveredDocuments: (
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
}

async function listAllContainerDocuments(input: {
  containerId: string;
  listContainerDocuments: DiscoverContainerDocumentsOptions["listContainerDocuments"];
}): Promise<ExplorerListContainerDocumentsResponse | null> {
  const items: ExplorerListedDocument[] = [];
  const tombstones: ExplorerListContainerDocumentsResponse["tombstones"][number][] =
    [];
  let watermark: SyncWatermark | null = null;

  do {
    const response = await input.listContainerDocuments(input.containerId, {
      watermark,
    });
    if (!response) {
      return null;
    }
    const normalizedResponse =
      normalizeListContainerDocumentsResponse(response);

    items.push(...normalizedResponse.items);
    tombstones.push(...normalizedResponse.tombstones);
    watermark = normalizedResponse.nextWatermark;

    if (!normalizedResponse.hasMore) {
      return {
        hasMore: false,
        items,
        nextWatermark: watermark,
        tombstones,
      };
    }
  } while (watermark);

  return {
    hasMore: false,
    items,
    nextWatermark: watermark,
    tombstones,
  };
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
  listContainerDocuments,
  replaceDocumentLinksBatch,
  upsertDiscoveredDocuments,
}: DiscoverContainerDocumentsOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  const listedDocuments = await listAllContainerDocuments({
    containerId,
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

  return upsertDiscoveredDocuments(
    listedDocuments.items.map((document) => ({
      accessEpoch: document.currentAccessEpoch,
      accessStateHash: document.currentAccessStateHash,
      containerId,
      createdAt: document.createdAt,
      documentId: document.id,
      linkedContainerIds: document.linkedContainerIds,
    })),
  );
}

export async function discoverAllContainerDocuments({
  cacheReferencedPrincipalPolicies,
  containerIds,
  listContainerDocuments,
  replaceDocumentLinksBatch,
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

  if (discoveredDocumentInputs.length === 0) {
    return [];
  }

  return upsertDiscoveredDocuments(discoveredDocumentInputs);
}
