import type { DocumentSummary } from "../../data/documents/documentSummary";
import { deriveStableDocumentId } from "../../data/documents/shared/stableDocumentId";

/** A deferred create keeps its intended links until its signed adoption verifies. */
export async function withoutDeferredDocumentLinks<
  T extends { documentId: string; containerIds: readonly string[] },
>(
  links: readonly T[],
  summaries: readonly DocumentSummary[],
): Promise<readonly T[]> {
  const deferredIds = new Set(
    await Promise.all(
      summaries
        .filter((summary) => summary.documentId === null)
        .map((summary) => deriveStableDocumentId(summary.id)),
    ),
  );
  return links.filter((link) => !deferredIds.has(link.documentId));
}
