import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { mergeVersionVectors } from "@tearleads/loro";
import { and, eq, gt } from "drizzle-orm";
import { readProcessedThroughSequence } from "../../../documents/documentProcessedCursor";

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

/**
 * The frontier a rotation baseline must cover: the merged declared ends of
 * the document's updates committed after the baseline's signed cursor. Its
 * author imported or voided every update up to the cursor, so the snapshot
 * already holds each one's real ops, and an update every reader voids, whose
 * declared ops no version holds, no longer refuses the baseline. A cursor
 * that is not an update of this document weighs every committed update. The
 * caller holds the document head lock, so no update commits after this read.
 */
export async function committedFrontierAfterBaselineCursor(
  executor: DatabaseSession,
  input: {
    readonly coversThroughUpdateId: string | undefined;
    readonly documentId: string;
  },
): Promise<string> {
  const afterSequence = await readProcessedThroughSequence(executor, {
    documentId: input.documentId,
    processedThroughUpdateId: input.coversThroughUpdateId,
  });
  const rows = await executor
    .select({
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, input.documentId),
        gt(documentUpdates.sequence, afterSequence),
      ),
    );
  return mergeVersionVectors(rows.map((row) => row.partialEndVersionVector));
}
