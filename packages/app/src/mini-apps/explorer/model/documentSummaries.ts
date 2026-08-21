import type { DocumentSummary } from "@symcrypt/client-sdk";

export function getDocumentByLocalId(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  localId: string,
) {
  return documentSummaries.find(
    (documentSummary) => documentSummary.id === localId,
  );
}
