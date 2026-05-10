import type { DocumentSummary } from "../../data/documentSummary";

export function getDocumentByLocalId(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  localId: string,
) {
  return documentSummaries.find(
    (documentSummary) => documentSummary.id === localId,
  );
}
