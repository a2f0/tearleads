import type { DocumentSummary } from "../../data/documentSummary";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";

export interface DocumentContainerProjection {
  containerId: string;
  createdAt: string;
  documentKind: StoredDocumentKind;
  localId: string;
  title: string;
  updatedAt: string;
}

export function buildDocumentsByContainerId(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>,
  validContainerIds: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyArray<DocumentContainerProjection>> {
  const nextDocumentsByContainerId = new Map<
    string,
    DocumentContainerProjection[]
  >();

  for (const documentSummary of documentSummaries) {
    const linkedContainerIds = documentSummary.documentId
      ? linkedContainerIdsByDocumentId.get(documentSummary.documentId)
      : undefined;
    const defaultContainerIds = documentSummary.containerId
      ? [documentSummary.containerId]
      : [];
    const candidateContainerIds =
      linkedContainerIds !== undefined && linkedContainerIds.length > 0
        ? linkedContainerIds
        : defaultContainerIds;

    if (candidateContainerIds.length === 0) {
      continue;
    }

    for (const containerId of candidateContainerIds) {
      if (!validContainerIds.has(containerId)) {
        continue;
      }

      const existingDocuments =
        nextDocumentsByContainerId.get(containerId) ?? [];
      existingDocuments.push({
        containerId,
        createdAt: documentSummary.createdAt ?? documentSummary.updatedAt,
        documentKind: documentSummary.documentKind ?? "note",
        localId: documentSummary.id,
        title: documentSummary.title,
        updatedAt: documentSummary.updatedAt,
      });
      nextDocumentsByContainerId.set(containerId, existingDocuments);
    }
  }

  for (const documents of nextDocumentsByContainerId.values()) {
    documents.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  return nextDocumentsByContainerId;
}
