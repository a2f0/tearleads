import { and, asc, eq, inArray } from "drizzle-orm";
import { documentIntentLinkTargets } from "../../sqlite/documentPlacementIntentSchema";
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
import {
  enqueueDocumentLinkIntent,
  enqueueDocumentMoveIntent,
  enqueueDocumentUnlinkIntent,
  loadDocumentIntentLinkTargets,
} from "./documentPlacementIntentEnqueue";

export const DOCUMENT_MOVE_INTENT_TYPE = "document.move";
export const DOCUMENT_LINK_INTENT_TYPE = "document.link";
const DOCUMENT_PLACEMENT_INTENT_TYPES = [
  DOCUMENT_MOVE_INTENT_TYPE,
  DOCUMENT_LINK_INTENT_TYPE,
];

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

/**
 * - `pending`: replays on every structural pass.
 * - `blocked`: the last pass could not proceed locally (missing local
 *   document / destination); replays, since hydration can heal it.
 * - `denied`: parked on a 403 until the access-restored replay (row 7).
 * - `unavailable`: terminal — after a projection refresh the destination
 *   itself is proven deleted (coded 404 on its own projection probe). No
 *   mutation 409 is ever terminal: with the destination live it can only
 *   name an ancestor or source, and the next pass's fresh paths outrun it.
 *   Container ids never return, so no replay can commit the intent as
 *   written; it leaves the replay set until the local container tombstone
 *   cascade retargets it or the user re-enqueues the move.
 */
export type DocumentMoveIntentSyncStatus =
  | "pending"
  | "blocked"
  | "denied"
  | "unavailable";

export interface DocumentMoveIntentRecord {
  additionalLinkContainerIds?: readonly string[] | undefined;
  removedLinkContainerIds?: readonly string[] | undefined;
  id: string;
  documentId: string;
  intentType:
    | typeof DOCUMENT_MOVE_INTENT_TYPE
    | typeof DOCUMENT_LINK_INTENT_TYPE;
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
  if (value === "blocked" || value === "denied" || value === "unavailable") {
    return value;
  }
  return "pending";
}

function resolveRecordedSyncStatus(input: {
  blocked?: boolean | undefined;
  denied?: boolean | undefined;
  unavailable?: boolean | undefined;
}): DocumentMoveIntentSyncStatus {
  if (input.unavailable) return "unavailable";
  if (input.denied) return "denied";
  return input.blocked ? "blocked" : "pending";
}

function mapDocumentMoveIntentRecord(
  row: SelectedDocumentMoveIntentRecord,
): DocumentMoveIntentRecord {
  return {
    id: String(row.id ?? ""),
    documentId: row.documentId,
    intentType:
      row.intentType === DOCUMENT_LINK_INTENT_TYPE
        ? DOCUMENT_LINK_INTENT_TYPE
        : DOCUMENT_MOVE_INTENT_TYPE,
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

  enqueueMoveIntent: enqueueDocumentMoveIntent,
  enqueueLinkIntent: enqueueDocumentLinkIntent,
  enqueueUnlinkIntent: enqueueDocumentUnlinkIntent,

  async listPendingMoveIntents(
    execSql: ExecSql,
  ): Promise<DocumentMoveIntentRecord[]> {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureSqlTables(lockedExecSql, documentMoveIntentTables);
      return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          const rows = await tx
            .select()
            .from(documentMoveIntents)
            // Blocked intents replay too: "blocked" names the reason the last
            // attempt could not proceed (missing local doc / destination), not a
            // terminal verdict. The blocking condition can heal after hydration or
            // recovery, and re-checking is cheap — a still-blocked intent simply
            // re-records its reason without counting as lane progress.
            // Unavailable intents never replay: the server proved a cited container
            // is gone, so every replay would re-issue the same doomed requests
            // (#2278 #4). Only the tombstone cascade or a re-enqueue revives them.
            .where(
              and(
                inArray(documentMoveIntents.syncStatus, ["pending", "blocked"]),
                inArray(
                  documentMoveIntents.intentType,
                  DOCUMENT_PLACEMENT_INTENT_TYPES,
                ),
              ),
            )
            .orderBy(asc(documentMoveIntents.createdAt));

          return Promise.all(
            rows.map(async (row) => {
              const targets = await loadDocumentIntentLinkTargets(
                lockedExecSql,
                row.id ?? "",
              );
              const added = targets
                .filter((target) => target.operation === "link")
                .map((target) => target.containerId)
                .sort();
              const removed = targets
                .filter((target) => target.operation === "unlink")
                .map((target) => target.containerId)
                .sort();
              return {
                ...mapDocumentMoveIntentRecord(row),
                ...(added.length ? { additionalLinkContainerIds: added } : {}),
                ...(removed.length ? { removedLinkContainerIds: removed } : {}),
              };
            }),
          );
        },
      );
    });
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
           AND intent_type IN (?, ?)
           AND updated_at = ?
           ${input.expectedIntentId ? "AND id = ?" : ""}
         RETURNING id`,
        [
          input.documentId,
          ...DOCUMENT_PLACEMENT_INTENT_TYPES,
          input.expectedUpdatedAt,
          ...(input.expectedIntentId ? [input.expectedIntentId] : []),
        ],
      );
      for (const { id } of deleted) {
        await getClientSQLitePersistenceRuntime(lockedExecSql)
          .db.delete(documentIntentLinkTargets)
          .where(eq(documentIntentLinkTargets.intentId, String(id)))
          .run();
      }
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
      stillCurrent?: (() => boolean) | undefined;
      /**
       * Server proof that a cited container was deleted (coded 404 or
       * `container_unavailable` 409): the intent parks terminally as
       * `unavailable`, outside every replay, until the tombstone cascade
       * retargets it or a re-enqueue replaces it. Outranks `denied`: a
       * restored permission cannot revive a deleted container.
       */
      unavailable?: boolean | undefined;
    },
  ): Promise<void> {
    await getClientSQLitePersistenceRuntime(execSql).guardedTransaction(
      async (db) => {
        const updatedAt = new Date().toISOString();
        await db
          .update(documentMoveIntents)
          .set({
            lastAttemptedAt: updatedAt,
            lastError: input.message,
            syncStatus: resolveRecordedSyncStatus(input),
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
              inArray(
                documentMoveIntents.intentType,
                DOCUMENT_PLACEMENT_INTENT_TYPES,
              ),
              ...(input.expectedIntentId
                ? [eq(documentMoveIntents.id, input.expectedIntentId)]
                : []),
              ...(input.expectedUpdatedAt
                ? [eq(documentMoveIntents.updatedAt, input.expectedUpdatedAt)]
                : []),
            ),
          )
          .run();
      },
      input.stillCurrent ?? (() => true),
      { behavior: "immediate" },
    );
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
         AND intent.intent_type IN (?, ?)
         ${input?.organizationId ? `AND (${DENIED_INTENT_ORGANIZATION_SQL} = ? OR ${DENIED_INTENT_ORGANIZATION_SQL} IS NULL)` : ""}
       LIMIT 1`,
      input?.organizationId
        ? [...DOCUMENT_PLACEMENT_INTENT_TYPES, input.organizationId]
        : DOCUMENT_PLACEMENT_INTENT_TYPES,
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
           AND intent_type IN (?, ?)
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
          ...DOCUMENT_PLACEMENT_INTENT_TYPES,
          ...(input?.localId ? [input.localId] : []),
          ...(input?.organizationId ? [input.organizationId] : []),
        ],
      );
    });
  },
};
