import type { DocumentSummary } from "@tearleads/client-sdk/data/documentSummary";

export function getDocumentByLocalId(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  localId: string,
) {
  return documentSummaries.find(
    (documentSummary) => documentSummary.id === localId,
  );
}
