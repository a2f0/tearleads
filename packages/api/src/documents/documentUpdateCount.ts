import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { and, count, eq, lte } from "drizzle-orm";

/**
 * How many updates the document holds at or before `sequence`. Updates are
 * deleted only with their whole document, so for a fixed `sequence` this
 * never decreases while the document exists.
 */
export async function countDocumentUpdatesThrough(
  executor: DatabaseSession,
  input: { readonly documentId: string; readonly sequence: number },
): Promise<number> {
  const [row] = await executor
    .select({ updates: count() })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, input.documentId),
        lte(documentUpdates.sequence, input.sequence),
      ),
    );
  return row?.updates ?? 0;
}
