import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

/**
 * Whether the document has any committed update, the frontier that a content-
 * key epoch advance would strand without a covering rotation baseline. A link
 * and a baseline-less unlink both refuse to rotate over one; the caller holds
 * the manifest-head write lock, so no update commits after this read.
 */
export async function hasCommittedDocumentUpdate(
  executor: DatabaseSession,
  documentId: string,
): Promise<boolean> {
  const [committedUpdate] = await executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId))
    .limit(1);
  return committedUpdate !== undefined;
}
