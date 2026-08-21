import type {
  DocumentClientProjectionDefinition,
  DocumentClientProjectionSaveInput,
} from "@symcrypt/client-sdk";
import {
  defineSqlTableSchema,
  getSQLitePersistenceRuntime,
} from "@symcrypt/client-sdk/sqlite";
import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

type ProjectionTable = SQLiteTable & { readonly localId: SQLiteColumn };

/**
 * A per-kind SQL client projection: upsert the projected row on save, delete
 * by localId on delete. `toRow` — the fold from the document's structured
 * fields to the table's row — is the only per-kind part.
 */
export function createDocumentSqlProjection<Table extends ProjectionTable>(
  table: Table,
  toRow: (input: DocumentClientProjectionSaveInput) => Table["$inferInsert"],
): DocumentClientProjectionDefinition {
  return {
    tables: [defineSqlTableSchema(table)],
    async save(input) {
      const row = toRow(input);
      await getSQLitePersistenceRuntime(input.execSql).runMutation(
        async (db) => {
          await db
            .insert(table)
            .values(row)
            .onConflictDoUpdate({ set: row, target: table.localId })
            .run();
        },
      );
    },
    async delete(input) {
      await getSQLitePersistenceRuntime(input.execSql).runMutation(
        async (db) => {
          await db.delete(table).where(eq(table.localId, input.localId)).run();
        },
      );
    },
  };
}
