import {
  maxEffectiveAccessLevel,
  normalizeEffectiveAccessLevel,
} from "../../data/accessLevel";
import type { DiscoveredDocumentInput } from "../../data/documentSummary";
import { uniqueSortedStrings } from "../../data/documents/shared/readers";
import type {
  ContainerDocumentTombstone,
  ListedContainerDocument,
  ListedContainerDocuments,
  ListedContainerDocumentsLane,
} from "./documentDiscoveryTypes";

function mergeDiscoveredDocumentInputs(
  current: DiscoveredDocumentInput,
  next: DiscoveredDocumentInput,
): DiscoveredDocumentInput {
  const accessStateHash =
    next.accessEpoch >= current.accessEpoch
      ? next.accessStateHash
      : current.accessStateHash;

  return {
    accessEpoch: Math.max(current.accessEpoch, next.accessEpoch),
    ...(accessStateHash === undefined ? {} : { accessStateHash }),
    containerId: current.containerId,
    createdAt:
      current.createdAt.localeCompare(next.createdAt) <= 0
        ? current.createdAt
        : next.createdAt,
    documentId: current.documentId,
    effectiveAccessLevel: maxEffectiveAccessLevel(
      normalizeEffectiveAccessLevel(current.effectiveAccessLevel),
      normalizeEffectiveAccessLevel(next.effectiveAccessLevel),
    ),
    linkedContainerIds: uniqueSortedStrings([
      current.containerId,
      next.containerId,
      ...current.linkedContainerIds,
      ...next.linkedContainerIds,
    ]),
  };
}

export function collectDiscoveredDocumentInputs(
  listedDocumentsByContainer: ReadonlyArray<ListedContainerDocumentsLane>,
): DiscoveredDocumentInput[] {
  const discoveredDocumentInputsByDocumentId = new Map<
    string,
    DiscoveredDocumentInput
  >();

  for (const { containerId, listedDocuments } of listedDocumentsByContainer) {
    if (!listedDocuments) {
      continue;
    }

    for (const document of listedDocuments.items) {
      const discoveredDocumentInput: DiscoveredDocumentInput = {
        accessEpoch: document.currentAccessEpoch,
        accessStateHash: document.currentAccessStateHash,
        containerId,
        createdAt: document.createdAt,
        documentId: document.id,
        effectiveAccessLevel: normalizeEffectiveAccessLevel(
          document.effectiveAccessLevel,
        ),
        linkedContainerIds: uniqueSortedStrings([
          containerId,
          ...document.linkedContainerIds,
        ]),
      };
      const currentDiscoveredDocumentInput =
        discoveredDocumentInputsByDocumentId.get(document.id);
      discoveredDocumentInputsByDocumentId.set(
        document.id,
        currentDiscoveredDocumentInput
          ? mergeDiscoveredDocumentInputs(
              currentDiscoveredDocumentInput,
              discoveredDocumentInput,
            )
          : discoveredDocumentInput,
      );
    }
  }

  return Array.from(discoveredDocumentInputsByDocumentId.values());
}

export function getApplicableDocumentTombstones(
  listedDocuments: ListedContainerDocuments,
): ContainerDocumentTombstone[] {
  const latestItemsByDocumentId = new Map<string, ListedContainerDocument>();
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
