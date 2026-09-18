import type { DocumentSummary } from "../../data/documents/documentSummary";

export interface PendingSummaryRead {
  discardResult: boolean;
  reloadAfter: boolean;
  persistedDocuments: Map<string, DocumentSummary>;
}

/** Content may paint before an autosave refresh; an obsolete placement may not. */
export function hasObsoletePlacement(
  read: PendingSummaryRead,
  containerId: string,
  summaries: readonly DocumentSummary[],
): boolean {
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  for (const persisted of read.persistedDocuments.values()) {
    const loaded = byId.get(persisted.id);
    if (
      loaded
        ? loaded.containerId !== persisted.containerId ||
          loaded.documentId !== persisted.documentId
        : persisted.containerId === containerId
    )
      return true;
  }
  return false;
}
