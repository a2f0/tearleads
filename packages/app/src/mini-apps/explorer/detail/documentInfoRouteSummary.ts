import type { DocumentSummary } from "@tearleads/client-sdk";
import { getDocumentByLocalId } from "../model/documentSummaries";

export function getDocumentInfoRouteFallbackSummary(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  localId: string;
  selectedDocument: DocumentSummary | undefined;
}): DocumentSummary | null {
  const candidate =
    params.selectedDocument?.id === params.localId
      ? params.selectedDocument
      : (getDocumentByLocalId(params.documentSummaries, params.localId) ??
        null);

  // Null-container rows are only safe after the active-organization orphan
  // query validates them. The routed loader supplies that scoped result.
  return candidate?.containerId === null ? null : candidate;
}
