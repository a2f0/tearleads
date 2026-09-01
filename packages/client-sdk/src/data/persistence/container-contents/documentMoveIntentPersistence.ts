import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  containerTables,
  documentMoveIntents,
  documentMoveIntentTables,
  documentProjectionTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";

export const DOCUMENT_MOVE_INTENT_TYPE = "document.move";

// Resolves the organization a parked move belongs to, in confidence order:
// the move's target container, the document's preserved projection
// attribution, then the container the document currently sits in. Normal
// saves routinely leave projection attribution empty (deferred-tail
// reporting resolves through the same container join), so the container rows
// carry the common case; rows with no resolvable organization stay in every
// scope (device-first shapes, matching orphan priming).
const DENIED_INTENT_ORGANIZATION_SQL = `COALESCE(
  NULLIF(target_container.organization_id, ''),
  NULLIF(projection.organization_id, ''),
  NULLIF(projection_container.organization_id, '')
)`;

const DENIED_INTENT_ORGANIZATION_JOINS_SQL = `
  LEFT JOIN containers target_container
    ON target_container.id = intent.target_container_id
  LEFT JOIN document_projection projection
    ON projection.local_id = intent.local_id
  LEFT JOIN containers projection_container
    ON projection_container.id = projection.container_id`;

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
      const id = input.id ?? crypto.randomUUID();
      const updatedAt = new Date().toISOString();
      const replaceLinkedContainers = input.replaceLinkedContainers ?? false;
      const sourceContainerId = input.sourceContainerId ?? null;
      const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);

      await db
        .insert(documentMoveIntents)
        .values({
          id,
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
            // Every enqueue is a new optimistic-concurrency revision. The
            // timestamp remains useful diagnostics, but cannot be the sole
            // revision token because two local moves can land in one clock
            // tick while an older remote request is settling.
            id,
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
      expectedIntentId?: string | undefined;
      expectedUpdatedAt: string;
    },
  ): Promise<boolean> {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const deleted = await lockedExecSql(
        `DELETE FROM document_move_intents
         WHERE document_id = ?
           AND intent_type = ?
           AND updated_at = ?
           ${input.expectedIntentId ? "AND id = ?" : ""}
         RETURNING document_id AS documentId`,
        [
          input.documentId,
          DOCUMENT_MOVE_INTENT_TYPE,
          input.expectedUpdatedAt,
          ...(input.expectedIntentId ? [input.expectedIntentId] : []),
        ],
      );
      return deleted.length > 0;
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
      /** Exact intent revision read by the pass; preferred over wall-clock CAS. */
      expectedIntentId?: string | undefined;
      /**
       * Optimistic concurrency: when given, the error only records against
       * the intent revision the pass read — a re-enqueued move (new
       * updatedAt) is never parked by a stale in-flight failure.
       */
      expectedUpdatedAt?: string | undefined;
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
            ...(input.expectedIntentId
              ? [eq(documentMoveIntents.id, input.expectedIntentId)]
              : []),
            ...(input.expectedUpdatedAt
              ? [eq(documentMoveIntents.updatedAt, input.expectedUpdatedAt)]
              : []),
          ),
        )
        .run();
    });
  },
  /**
   * Evidence for the org-access-restored re-arm gate: a parked
   * permission-denied move proves a queued write was refused.
   */
  async hasDeniedMoveIntents(
    execSql: ExecSql,
    input?: { organizationId?: string },
  ): Promise<boolean> {
    await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
    await ensureSqlTables(execSql, [
      ...documentProjectionTables,
      ...containerTables,
    ]);
    const rows = await execSql(
      `SELECT intent.document_id AS document_id
       FROM document_move_intents intent
       ${input?.organizationId ? DENIED_INTENT_ORGANIZATION_JOINS_SQL : ""}
       WHERE intent.sync_status = 'denied'
         AND intent.intent_type = ?
         ${input?.organizationId ? `AND (${DENIED_INTENT_ORGANIZATION_SQL} = ? OR ${DENIED_INTENT_ORGANIZATION_SQL} IS NULL)` : ""}
       LIMIT 1`,
      input?.organizationId
        ? [DOCUMENT_MOVE_INTENT_TYPE, input.organizationId]
        : [DOCUMENT_MOVE_INTENT_TYPE],
    );
    return rows.length > 0;
  },
  /**
   * Flip parked permission-denied moves back to pending so the re-armed
   * structural pass replays them (access restored, or a manual retry scoped
   * to one document).
   */
  async resetDeniedMoveIntents(
    execSql: ExecSql,
    input?: { localId?: string; organizationId?: string },
  ): Promise<void> {
    await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
    await ensureSqlTables(execSql, [
      ...documentProjectionTables,
      ...containerTables,
    ]);
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      // Organization scoping resolves each intent's organization through the
      // container joins above: restoring one organization's access must not
      // un-park moves that another organization still denies. Rows with no
      // resolvable organization are included (device-first shapes).
      await lockedExecSql(
        `UPDATE document_move_intents
         SET sync_status = 'pending', updated_at = ?
         WHERE sync_status = 'denied'
           AND intent_type = ?
           ${input?.localId ? "AND local_id = ?" : ""}
           ${
             input?.organizationId
               ? `AND local_id IN (
                    SELECT intent.local_id FROM document_move_intents intent
                    ${DENIED_INTENT_ORGANIZATION_JOINS_SQL}
                    WHERE ${DENIED_INTENT_ORGANIZATION_SQL} = ?
                      OR ${DENIED_INTENT_ORGANIZATION_SQL} IS NULL
                  )`
               : ""
           }`,
        [
          new Date().toISOString(),
          DOCUMENT_MOVE_INTENT_TYPE,
          ...(input?.localId ? [input.localId] : []),
          ...(input?.organizationId ? [input.organizationId] : []),
        ],
      );
    });
  },
};
