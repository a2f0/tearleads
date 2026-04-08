import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";

import type { NoteSummary } from "../notes/notesPersistence";

interface ExplorerListedDocument {
  createdAt: string;
  currentAccessEpoch: number;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
}

interface DiscoveredNoteInput {
  accessEpoch: number;
  containerId: string;
  createdAt: string;
  documentId: string;
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
  upsertDiscoveredNotes: (
    inputs: ReadonlyArray<DiscoveredNoteInput>,
  ) => Promise<ReadonlyArray<NoteSummary>>;
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
  upsertDiscoveredNotes,
}: DiscoverContainerDocumentsOptions): Promise<ReadonlyArray<NoteSummary> | null> {
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

  return upsertDiscoveredNotes(
    listedDocuments.map((document) => ({
      accessEpoch: document.currentAccessEpoch,
      containerId,
      createdAt: document.createdAt,
      documentId: document.id,
    })),
  );
}

export async function discoverAllContainerDocuments({
  cacheReferencedPrincipalPolicies,
  containerIds,
  listContainerDocuments,
  replaceDocumentLinksBatch,
  upsertDiscoveredNotes,
}: DiscoverAllContainerDocumentsOptions): Promise<ReadonlyArray<NoteSummary>> {
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
  const discoveredNoteInputs: DiscoveredNoteInput[] = [];

  for (const { containerId, listedDocuments } of listedDocumentsByContainer) {
    if (!listedDocuments) {
      continue;
    }

    for (const document of listedDocuments) {
      documentLinks.push({
        documentId: document.id,
        containerIds: document.linkedContainerIds,
      });
      discoveredNoteInputs.push({
        accessEpoch: document.currentAccessEpoch,
        containerId,
        createdAt: document.createdAt,
        documentId: document.id,
      });
    }
  }

  await replaceDocumentLinksBatch(documentLinks);

  if (discoveredNoteInputs.length === 0) {
    return [];
  }

  return upsertDiscoveredNotes(discoveredNoteInputs);
}
