import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";

import type { NoteSummary } from "../notes/notesPersistence";

interface ExplorerListedDocument {
  createdAt: string;
  currentAccessEpoch: number;
  id: string;
  linkedContainerIds: string[];
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
  containerId,
  listContainerDocuments,
  replaceDocumentLinksBatch,
  upsertDiscoveredNotes,
}: DiscoverContainerDocumentsOptions): Promise<ReadonlyArray<NoteSummary> | null> {
  const listedDocuments = await listContainerDocuments(containerId);
  if (!listedDocuments) {
    return null;
  }

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
  containerIds,
  listContainerDocuments,
  replaceDocumentLinksBatch,
  upsertDiscoveredNotes,
}: DiscoverAllContainerDocumentsOptions): Promise<ReadonlyArray<NoteSummary>> {
  const discoveredNotes: NoteSummary[] = [];
  const uniqueContainerIds = Array.from(new Set(containerIds));

  for (const containerId of uniqueContainerIds) {
    const nextNotes = await discoverContainerDocuments({
      containerId,
      listContainerDocuments,
      replaceDocumentLinksBatch,
      upsertDiscoveredNotes,
    });
    if (nextNotes) {
      discoveredNotes.push(...nextNotes);
    }
  }

  return discoveredNotes;
}
