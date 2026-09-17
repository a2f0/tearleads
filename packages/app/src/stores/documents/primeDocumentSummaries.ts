import type {
  ContainerDocumentLinks,
  DocumentSummary,
} from "@tearleads/client-sdk";

/** Open only the requested rows; the SDK owns caching and sync scheduling. */
export function primeDocumentSummaries(input: {
  documentLinks: Pick<ContainerDocumentLinks, "openDocument">;
  isCurrent?: (() => boolean) | undefined;
  summaries: ReadonlyArray<DocumentSummary>;
}): void {
  for (const summary of input.summaries) {
    if (input.isCurrent?.() === false) return;
    if (!summary.containerId || !summary.documentId) continue;
    input.documentLinks.openDocument({
      containerId: summary.containerId,
      documentId: summary.documentId,
      localId: summary.id,
    });
  }
}
