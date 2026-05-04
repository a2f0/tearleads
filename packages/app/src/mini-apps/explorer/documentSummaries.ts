import type { DocumentSummary } from "../../data/persistence/documents/documentsPersistence";

export function getDocumentByLocalId(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  localId: string,
) {
  return documentSummaries.find(
    (documentSummary) => documentSummary.id === localId,
  );
}
