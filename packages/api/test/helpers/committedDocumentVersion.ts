import { db } from "@tearleads/api-shared/postgres";
import { documentUpdateSpans } from "@tearleads/api-shared/schema";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { eq } from "drizzle-orm";

/**
 * The version vector of every op the document has committed so far, as an
 * uploader that has pulled the whole document would send it with a bind.
 */
export async function committedDocumentVersionVector(
  documentId: string,
): Promise<string> {
  const spans = await db
    .select({
      endCounter: documentUpdateSpans.endCounter,
      peerId: documentUpdateSpans.peerId,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.documentId, documentId));
  const counters: Record<string, number> = {};
  for (const span of spans) {
    counters[span.peerId] = Math.max(
      counters[span.peerId] ?? 0,
      span.endCounter,
    );
  }
  return encodeVersionVectorCounters(counters);
}
