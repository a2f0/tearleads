import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { and, count, eq, lte, type SQL, sql } from "drizzle-orm";

/**
 * How many updates the server holds for the document `documentId` (a uuid
 * expression) names, as a scalar subquery for a listing row. A write adds
 * one, and updates are deleted only with their document, so this grows
 * exactly when the document gains an update, independent of any clock or of
 * what the updates claim to carry.
 */
export function documentUpdateCountExpression(documentId: SQL): SQL {
  return sql`(
    select count(*)::int
    from ${documentUpdates}
    where ${documentUpdates.documentId} = ${documentId}
  )`;
}

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
