import {
  maxEffectiveAccessLevel,
  normalizeEffectiveAccessLevel,
} from "../../data/accessLevel";
import { uniqueSortedStrings } from "../../data/documents/shared/readers";
import type { DiscoveredDocumentCandidate } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type {
  ContainerDocumentTombstone,
  ListedContainerDocument,
  ListedContainerDocuments,
  ListedContainerDocumentsLane,
} from "./documentDiscoveryTypes";

function mergeDiscoveredDocumentInputs(
  current: DiscoveredDocumentCandidate,
  next: DiscoveredDocumentCandidate,
): DiscoveredDocumentCandidate {
  // A lane page carries a complete link set for its epoch. Combining an old
  // root page with a newer trash page must not manufacture a newer root link.
  if (next.accessEpoch !== current.accessEpoch) {
    return {
      ...(next.accessEpoch > current.accessEpoch ? next : current),
      listedContainerIds: uniqueSortedStrings([
        ...current.listedContainerIds,
        ...next.listedContainerIds,
      ]),
    };
  }
  const accessStateHash =
    next.accessEpoch >= current.accessEpoch
      ? next.accessStateHash
      : current.accessStateHash;

  return {
    accessEpoch: Math.max(current.accessEpoch, next.accessEpoch),
    ...(accessStateHash === undefined ? {} : { accessStateHash }),
    containerId: current.containerId,
    listedContainerIds: uniqueSortedStrings([
      ...current.listedContainerIds,
      ...next.listedContainerIds,
    ]),
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
): DiscoveredDocumentCandidate[] {
  const discoveredDocumentInputsByDocumentId = new Map<
    string,
    DiscoveredDocumentCandidate
  >();

  for (const { containerId, listedDocuments } of listedDocumentsByContainer) {
    if (!listedDocuments) {
      continue;
    }

    for (const document of listedDocuments.items) {
      const discoveredDocumentInput: DiscoveredDocumentCandidate = {
        accessEpoch: document.currentAccessEpoch,
        accessStateHash: document.currentAccessStateHash,
        containerId,
        listedContainerIds: [containerId],
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
      const currentDiscoveredDocumentCandidate =
        discoveredDocumentInputsByDocumentId.get(document.id);
      discoveredDocumentInputsByDocumentId.set(
        document.id,
        currentDiscoveredDocumentCandidate
          ? mergeDiscoveredDocumentInputs(
              currentDiscoveredDocumentCandidate,
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
      !item?.linkedContainerIds.includes(tombstone.containerId) ||
      item.updatedAt.localeCompare(tombstone.updatedAt) < 0
    );
  });
}
