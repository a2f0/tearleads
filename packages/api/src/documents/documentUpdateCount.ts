import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import { and, count, eq, lte, type SQL, sql } from "drizzle-orm";

/**
 * How many updates the server holds for the document `documentId` (a uuid
 * expression) names, as a scalar subquery for a listing row: the document
 * row's own `update_count`, which the `count_document_updates` trigger keeps
 * in the transaction that inserts an update. A write adds one, and updates
 * are deleted only with their document, so it grows exactly when the
 * document gains an update, independent of any clock or of what the updates
 * claim to carry. A document with no row counts none.
 */
export function documentUpdateCountExpression(documentId: SQL): SQL {
  return sql`coalesce((
    select counted.update_count
    from ${documents} counted
    where counted.id = ${documentId}
  ), 0)`;
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
