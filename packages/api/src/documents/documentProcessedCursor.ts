import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";

/**
 * The commit position of a reader's processed cursor: the last update of a
 * pull it completed, having imported or voided every update served to it up
 * to there. Zero when the reader sent none or named an update this document
 * does not hold, so an unknown cursor serves more, never less.
 */
export async function readProcessedThroughSequence(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly processedThroughUpdateId: string | undefined;
  },
): Promise<number> {
  if (input.processedThroughUpdateId === undefined) return 0;
  const [row] = await executor
    .select({ sequence: documentUpdates.sequence })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, input.documentId),
        eq(documentUpdates.id, input.processedThroughUpdateId),
      ),
    )
    .limit(1);
  return row?.sequence ?? 0;
}
