import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/persistence/documents/documentsPersistence";

interface ExplorerListedDocument {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
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
  listContainerDocuments: (
    containerId: string,
  ) => Promise<ReadonlyArray<ExplorerListedDocument> | null>;
  replaceDocumentLinksBatch: (
    inputs: ReadonlyArray<DocumentLinkInput>,
  ) => Promise<void>;
  upsertDiscoveredDocuments: (
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
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
  const listedDocuments = await listContainerDocuments(containerId);
  if (!listedDocuments) {
    return null;
  }

  await cacheReferencedPrincipalPolicies?.(
    listedDocuments.flatMap((document) => document.referencedPrincipals ?? []),
  );

  await replaceDocumentLinksBatch(
    listedDocuments.map((document) => ({
      documentId: document.id,
      containerIds: document.linkedContainerIds,
    })),
  );

  return upsertDiscoveredDocuments(
    listedDocuments.map((document) => ({
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
      listedDocuments: await listContainerDocuments(containerId),
    })),
  );
  await cacheReferencedPrincipalPolicies?.(
    listedDocumentsByContainer.flatMap(
      ({ listedDocuments }) =>
        listedDocuments?.flatMap(
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

    for (const document of listedDocuments) {
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
