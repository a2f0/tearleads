import type {
  ContainerDocumentTombstone,
  ListedContainerDocuments,
} from "./documentDiscoveryTypes";

/** Preserve a conflicting live candidate for signed-head verification. */
export function unopposedDocumentTombstones(
  listedDocuments: ListedContainerDocuments,
): ContainerDocumentTombstone[] {
  const linkedByDocument = new Map<string, Set<string>>();
  for (const item of listedDocuments.items) {
    const linked = linkedByDocument.get(item.id) ?? new Set<string>();
    for (const id of item.linkedContainerIds) linked.add(id);
    linkedByDocument.set(item.id, linked);
  }
  return listedDocuments.tombstones.filter(
    (row) => !linkedByDocument.get(row.documentId)?.has(row.containerId),
  );
}
