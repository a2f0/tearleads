import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  documentMoveIntents,
  documentMoveIntentTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";

const DOCUMENT_MOVE_INTENT_TYPE = "document.move";

export type DocumentMoveIntentSyncStatus = "pending" | "blocked" | "denied";

export interface DocumentMoveIntentRecord {
  id: string;
  documentId: string;
  intentType: typeof DOCUMENT_MOVE_INTENT_TYPE;
  lastAttemptedAt: string | null;
  lastError: string | null;
  localId: string;
  replaceLinkedContainers: boolean;
  sourceContainerId: string | null;
  syncStatus: DocumentMoveIntentSyncStatus;
  targetContainerId: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentMoveIntentInput {
  id?: string | undefined;
  documentId: string;
  localId: string;
  replaceLinkedContainers?: boolean | undefined;
  sourceContainerId?: string | null | undefined;
  targetContainerId: string;
}

interface SelectedDocumentMoveIntentRecord {
  id: string | null;
  documentId: string;
  intentType: string;
  lastAttemptedAt: string | null;
  lastError: string | null;
  localId: string;
  replaceLinkedContainers: boolean;
  sourceContainerId: string | null;
  syncStatus: string;
  targetContainerId: string;
  createdAt: string;
  updatedAt: string;
}

function parseDocumentMoveIntentSyncStatus(
  value: unknown,
): DocumentMoveIntentSyncStatus {
  if (value === "blocked" || value === "denied") {
    return value;
  }
  return "pending";
}

function mapDocumentMoveIntentRecord(
  row: SelectedDocumentMoveIntentRecord,
): DocumentMoveIntentRecord {
  return {
    id: String(row.id ?? ""),
    documentId: row.documentId,
    intentType: DOCUMENT_MOVE_INTENT_TYPE,
    lastAttemptedAt: row.lastAttemptedAt,
    lastError: row.lastError,
    localId: row.localId,
    replaceLinkedContainers: Boolean(row.replaceLinkedContainers),
    sourceContainerId: row.sourceContainerId,
    syncStatus: parseDocumentMoveIntentSyncStatus(row.syncStatus),
    targetContainerId: row.targetContainerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const sqlDocumentMoveIntentPersistence = {
  async ensureSchema(execSql: ExecSql): Promise<void> {
    await ensureSqlTables(execSql, documentMoveIntentTables);
  },

  async enqueueMoveIntent(
    execSql: ExecSql,
    input: DocumentMoveIntentInput,
  ): Promise<void> {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureSqlTables(lockedExecSql, documentMoveIntentTables);
      const updatedAt = new Date().toISOString();
      const replaceLinkedContainers = input.replaceLinkedContainers ?? false;
      const sourceContainerId = input.sourceContainerId ?? null;
      const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);

      await db
        .insert(documentMoveIntents)
        .values({
          id: input.id ?? crypto.randomUUID(),
          documentId: input.documentId,
          intentType: DOCUMENT_MOVE_INTENT_TYPE,
          lastAttemptedAt: null,
          lastError: null,
          localId: input.localId,
          replaceLinkedContainers,
          sourceContainerId,
          syncStatus: "pending",
          targetContainerId: input.targetContainerId,
          createdAt: updatedAt,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: documentMoveIntents.documentId,
          set: {
            intentType: DOCUMENT_MOVE_INTENT_TYPE,
            lastError: null,
            localId: input.localId,
            replaceLinkedContainers: replaceLinkedContainers
              ? true
              : sql`${documentMoveIntents.replaceLinkedContainers}`,
            sourceContainerId: sql`coalesce(${documentMoveIntents.sourceContainerId}, ${sourceContainerId})`,
            syncStatus: "pending",
            targetContainerId: input.targetContainerId,
            updatedAt,
          },
        })
        .run();
    });
  },

  async listPendingMoveIntents(
    execSql: ExecSql,
  ): Promise<DocumentMoveIntentRecord[]> {
    await ensureSqlTables(execSql, documentMoveIntentTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        id: documentMoveIntents.id,
        documentId: documentMoveIntents.documentId,
        intentType: documentMoveIntents.intentType,
        lastAttemptedAt: documentMoveIntents.lastAttemptedAt,
        lastError: documentMoveIntents.lastError,
        localId: documentMoveIntents.localId,
        replaceLinkedContainers: documentMoveIntents.replaceLinkedContainers,
        sourceContainerId: documentMoveIntents.sourceContainerId,
        syncStatus: documentMoveIntents.syncStatus,
        targetContainerId: documentMoveIntents.targetContainerId,
        createdAt: documentMoveIntents.createdAt,
        updatedAt: documentMoveIntents.updatedAt,
      })
      .from(documentMoveIntents)
      // Blocked intents replay too: "blocked" names the reason the last
      // attempt could not proceed (missing local doc / destination), not a
      // terminal verdict. The blocking condition can heal after hydration or
      // recovery, and re-checking is cheap — a still-blocked intent simply
      // re-records its reason without counting as lane progress.
      .where(
        and(
          inArray(documentMoveIntents.syncStatus, ["pending", "blocked"]),
          eq(documentMoveIntents.intentType, DOCUMENT_MOVE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(documentMoveIntents.createdAt));

    return rows.map((row) => mapDocumentMoveIntentRecord(row));
  },

  async markMoveIntentSynced(
    execSql: ExecSql,
    input: {
      documentId: string;
      expectedUpdatedAt: string;
    },
  ): Promise<void> {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentMoveIntents)
        .where(
          and(
            eq(documentMoveIntents.documentId, input.documentId),
            eq(documentMoveIntents.intentType, DOCUMENT_MOVE_INTENT_TYPE),
            eq(documentMoveIntents.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .run();
    });
  },

  async recordMoveIntentError(
    execSql: ExecSql,
    input: {
      blocked?: boolean | undefined;
      /**
       * A permission denial (403): the intent parks as `denied` — excluded
       * from routine structural replays — until the org-access-restored
       * signal or a manual retry flips it back to pending (edge-case row 7).
       */
      denied?: boolean | undefined;
      documentId: string;
      message: string;
    },
  ): Promise<void> {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const updatedAt = new Date().toISOString();
      await db
        .update(documentMoveIntents)
        .set({
          lastAttemptedAt: updatedAt,
          lastError: input.message,
          syncStatus: input.denied
            ? "denied"
            : input.blocked
              ? "blocked"
              : "pending",
          updatedAt,
        })
        .where(
          and(
            eq(documentMoveIntents.documentId, input.documentId),
            // Blocked/denied rows must stay updatable: a retried intent
            // records its fresh outcome, and a transient failure flips it
            // back to pending instead of freezing it forever.
            inArray(documentMoveIntents.syncStatus, [
              "pending",
              "blocked",
              "denied",
            ]),
            eq(documentMoveIntents.intentType, DOCUMENT_MOVE_INTENT_TYPE),
          ),
        )
        .run();
    });
  },
  /**
   * Evidence for the org-access-restored re-arm gate: a parked
   * permission-denied move proves a queued write was refused.
   */
  async hasDeniedMoveIntents(execSql: ExecSql): Promise<boolean> {
    await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({ documentId: documentMoveIntents.documentId })
      .from(documentMoveIntents)
      .where(
        and(
          eq(documentMoveIntents.syncStatus, "denied"),
          eq(documentMoveIntents.intentType, DOCUMENT_MOVE_INTENT_TYPE),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },
  /**
   * Flip parked permission-denied moves back to pending so the re-armed
   * structural pass replays them (access restored, or a manual retry scoped
   * to one document).
   */
  async resetDeniedMoveIntents(
    execSql: ExecSql,
    input?: { localId?: string },
  ): Promise<void> {
    await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .update(documentMoveIntents)
        .set({ syncStatus: "pending", updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(documentMoveIntents.syncStatus, "denied"),
            eq(documentMoveIntents.intentType, DOCUMENT_MOVE_INTENT_TYPE),
            ...(input?.localId
              ? [eq(documentMoveIntents.localId, input.localId)]
              : []),
          ),
        )
        .run();
    });
  },
};
