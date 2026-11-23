import { and, eq, inArray, ne } from "drizzle-orm";
import { documentRecordedAttachmentSlots as recordedSlots } from "../../../sqlite/schema/documentAttachmentSightingSchema";
import {
  documents,
  documentTables,
} from "../../../sqlite/schema/documentRecordSchema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../../../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../../sqlite/sqliteUpsert";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";
import type { DocumentScope } from "./documentPersistenceTypes";

// Two binds name the scope; the rest carry slot ids.
const SLOT_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 2);
// One bind names the app kind; the rest carry local ids.
const LOCAL_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 1);

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function slotScope(scope: DocumentScope) {
  return and(
    eq(recordedSlots.appKind, scope.appKind),
    eq(recordedSlots.localId, scope.localId),
  );
}

/** Whether the local record is still bound to `documentId`. */
async function isBoundTo(
  db: ClientSQLiteTransactionScope,
  scope: DocumentScope,
  documentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ documentId: documents.documentId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, scope.appKind),
        eq(documents.localId, scope.localId),
      ),
    )
    .limit(1);
  return row?.documentId === documentId;
}

/**
 * The attachment slots a document store saw recorded, durable across
 * restarts. Each call joins the connection's mutation queue when it is made,
 * so one store's writes, and a later store's read, land in the order they
 * were called. Rows exist only while the local record is bound to the
 * document they were seen in: a write that arrives after the record was
 * deleted or bound elsewhere is dropped.
 */
export class RecordedAttachmentSlotRepository {
  constructor(private readonly execSql: ExecSql) {}

  /**
   * Keeps each slot as seen in `documentId`. A slot already kept for that
   * document keeps its first time; one kept for another is replaced.
   */
  record(
    scope: DocumentScope,
    input: {
      readonly documentId: string;
      readonly seenAt: string;
      readonly slotIds: readonly string[];
    },
  ): Promise<void> {
    return this.mutate(async (db) => {
      if (!(await isBoundTo(db, scope, input.documentId))) return;
      const batchSize = sqliteInsertBatchSize(recordedSlots);
      for (const batch of chunks(input.slotIds, batchSize)) {
        await db
          .insert(recordedSlots)
          .values(
            batch.map((slotId) => ({
              ...scope,
              documentId: input.documentId,
              seenAt: input.seenAt,
              slotId,
            })),
          )
          .onConflictDoUpdate({
            target: [
              recordedSlots.appKind,
              recordedSlots.localId,
              recordedSlots.slotId,
            ],
            set: {
              documentId: excludedValue(recordedSlots.documentId),
              seenAt: excludedValue(recordedSlots.seenAt),
            },
            setWhere: ne(
              recordedSlots.documentId,
              excludedValue(recordedSlots.documentId),
            ),
          })
          .run();
      }
    });
  }

  forget(scope: DocumentScope, slotIds: readonly string[]): Promise<void> {
    return this.mutate(async (db) => {
      for (const batch of chunks(slotIds, SLOT_IDS_PER_STATEMENT)) {
        await db
          .delete(recordedSlots)
          .where(and(slotScope(scope), inArray(recordedSlots.slotId, batch)))
          .run();
      }
    });
  }

  /**
   * The slots seen in `documentId`, or none once the record is bound
   * elsewhere. Rows another server document left are dropped: a store
   * relinked to another document starts over.
   */
  restore(scope: DocumentScope, documentId: string): Promise<string[]> {
    return this.mutate(async (db) => {
      if (!(await isBoundTo(db, scope, documentId))) return [];
      await db
        .delete(recordedSlots)
        .where(and(slotScope(scope), ne(recordedSlots.documentId, documentId)))
        .run();
      const rows = await db
        .select({ slotId: recordedSlots.slotId })
        .from(recordedSlots)
        .where(and(slotScope(scope), eq(recordedSlots.documentId, documentId)));
      return rows.map((row) => row.slotId);
    });
  }

  private mutate<T>(
    operation: (db: ClientSQLiteTransactionScope) => Promise<T>,
  ): Promise<T> {
    return runSerializedSqlMutation(this.execSql, async (locked) => {
      await ensureSqlTables(locked, documentTables);
      return operation(getClientSQLitePersistenceRuntime(locked).db);
    });
  }
}

/** Drops the sightings of these records, as a delete or rebind of them does. */
export async function deleteRecordedAttachmentSlotsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
  for (const batch of chunks(localIds, LOCAL_IDS_PER_STATEMENT)) {
    await tx
      .delete(recordedSlots)
      .where(
        and(
          eq(recordedSlots.appKind, appKind),
          inArray(recordedSlots.localId, batch),
        ),
      )
      .run();
  }
}
