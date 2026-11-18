import type {
  ContainerDocumentTombstone,
  ListedContainerDocument,
  ListedContainerDocuments,
} from "./documentDiscoveryTypes";

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
