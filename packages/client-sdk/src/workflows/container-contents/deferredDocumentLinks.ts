import type { DocumentSummary } from "../../data/documents/documentSummary";
import { deriveStableDocumentId } from "../../data/documents/shared/stableDocumentId";

/** A deferred create keeps its intended links until its signed adoption verifies. */
export async function withoutDeferredDocumentLinks(
  links: readonly { documentId: string; containerIds: readonly string[] }[],
  summaries: readonly DocumentSummary[],
): Promise<readonly { documentId: string; containerIds: readonly string[] }[]> {
  const deferredIds = new Set(
    await Promise.all(
      summaries
        .filter((summary) => summary.documentId === null)
        .map((summary) => deriveStableDocumentId(summary.id)),
    ),
  );
  return links.filter((link) => !deferredIds.has(link.documentId));
}
