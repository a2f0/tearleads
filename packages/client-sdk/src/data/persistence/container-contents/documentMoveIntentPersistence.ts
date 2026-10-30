import { and, asc, eq, inArray } from "drizzle-orm";
import {
  containerTables,
  documentPlacementIntentTables,
  documentProjectionTables,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import { documentIntentLinkTargets } from "../../sqlite/schema/documentPlacementIntentSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  enqueueDocumentLinkIntent,
  enqueueDocumentMoveIntent,
  enqueueDocumentUnlinkIntent,
} from "./documentPlacementIntentEnqueue";

type DocumentIntentLinkTarget = {
  containerId: string;
  operation: "link" | "unlink";
};

export const DOCUMENT_MOVE_INTENT_TYPE = "document.move";
const INTENT_IDS_PER_STATEMENT = sqliteRowsPerStatement(1);

/** Every listed intent's link targets, one keyed read per bind budget. */
async function loadLinkTargetsByIntent(
  tx: ClientSQLiteTransactionScope,
  intentIds: readonly string[],
): Promise<ReadonlyMap<string, readonly DocumentIntentLinkTarget[]>> {
  const targetsByIntent = new Map<string, DocumentIntentLinkTarget[]>();
  const uniqueIds = [...new Set(intentIds)];
  for (
    let index = 0;
    index < uniqueIds.length;
    index += INTENT_IDS_PER_STATEMENT
  ) {
    const rows = await tx
      .select({
        containerId: documentIntentLinkTargets.containerId,
        intentId: documentIntentLinkTargets.intentId,
        operation: documentIntentLinkTargets.operation,
      })
      .from(documentIntentLinkTargets)
      .where(
        inArray(
          documentIntentLinkTargets.intentId,
          uniqueIds.slice(index, index + INTENT_IDS_PER_STATEMENT),
        ),
      );
    for (const { intentId, ...target } of rows) {
      const targets = targetsByIntent.get(intentId) ?? [];
      targets.push(target);
      targetsByIntent.set(intentId, targets);
    }
  }
  return targetsByIntent;
}
const placementLane = inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement);
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
  localId: string | null;
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
    // Placement intents always carry their local document row.
    localId: row.localId ?? "",
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
    await ensureSqlTables(execSql, documentPlacementIntentTables);
  },

  enqueueMoveIntent: enqueueDocumentMoveIntent,
  enqueueLinkIntent: enqueueDocumentLinkIntent,
  enqueueUnlinkIntent: enqueueDocumentUnlinkIntent,

  async listPendingMoveIntents(
    execSql: ExecSql,
  ): Promise<DocumentMoveIntentRecord[]> {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureSqlTables(lockedExecSql, documentPlacementIntentTables);
      return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          const rows = await tx
            .select({
              id: localIntents.id,
              documentId: localIntents.subjectId,
              intentType: localIntents.intentType,
              lastAttemptedAt: localIntents.lastAttemptedAt,
              lastError: localIntents.lastError,
              localId: localIntents.localId,
              replaceLinkedContainers: localIntents.replaceLinkedContainers,
              sourceContainerId: localIntents.sourceContainerId,
              syncStatus: localIntents.syncStatus,
              targetContainerId: localIntents.targetContainerId,
              createdAt: localIntents.createdAt,
              updatedAt: localIntents.updatedAt,
            })
            .from(localIntents)
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
                placementLane,
                inArray(localIntents.syncStatus, ["pending", "blocked"]),
                inArray(
                  localIntents.intentType,
                  DOCUMENT_PLACEMENT_INTENT_TYPES,
                ),
              ),
            )
            .orderBy(asc(localIntents.createdAt));

          const targetsByIntent = await loadLinkTargetsByIntent(
            tx,
            rows.map((row) => row.id ?? ""),
          );
          return rows.map((row) => {
            const targets = targetsByIntent.get(row.id ?? "") ?? [];
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
          });
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
        `DELETE FROM local_intents
         WHERE lane = ?
           AND subject_id = ?
           AND intent_type IN (?, ?)
           AND updated_at = ?
           ${input.expectedIntentId ? "AND id = ?" : ""}
         RETURNING id`,
        [
          LOCAL_INTENT_LANES.documentPlacement,
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
          .update(localIntents)
          .set({
            lastAttemptedAt: updatedAt,
            lastError: input.message,
            syncStatus: resolveRecordedSyncStatus(input),
            updatedAt,
          })
          .where(
            and(
              placementLane,
              eq(localIntents.subjectId, input.documentId),
              // Blocked/denied rows must stay updatable: a retried intent
              // records its fresh outcome, and a transient failure flips it
              // back to pending instead of freezing it forever.
              inArray(localIntents.syncStatus, [
                "pending",
                "blocked",
                "denied",
              ]),
              inArray(localIntents.intentType, DOCUMENT_PLACEMENT_INTENT_TYPES),
              ...(input.expectedIntentId
                ? [eq(localIntents.id, input.expectedIntentId)]
                : []),
              ...(input.expectedUpdatedAt
                ? [eq(localIntents.updatedAt, input.expectedUpdatedAt)]
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
      `SELECT intent.subject_id AS document_id
       FROM local_intents intent
       ${input?.organizationId ? DENIED_INTENT_ORGANIZATION_JOINS_SQL : ""}
       WHERE intent.lane = ?
         AND intent.sync_status = 'denied'
         AND intent.intent_type IN (?, ?)
         ${input?.organizationId ? `AND (${DENIED_INTENT_ORGANIZATION_SQL} = ? OR ${DENIED_INTENT_ORGANIZATION_SQL} IS NULL)` : ""}
       LIMIT 1`,
      [
        LOCAL_INTENT_LANES.documentPlacement,
        ...DOCUMENT_PLACEMENT_INTENT_TYPES,
        ...(input?.organizationId ? [input.organizationId] : []),
      ],
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
        `UPDATE local_intents
         SET sync_status = 'pending', updated_at = ?
         WHERE lane = ?
           AND sync_status = 'denied'
           AND intent_type IN (?, ?)
           ${input?.localId ? "AND local_id = ?" : ""}
           ${
             input?.organizationId
               ? `AND local_id IN (
                    SELECT intent.local_id FROM local_intents intent
                    ${DENIED_INTENT_ORGANIZATION_JOINS_SQL}
                    WHERE intent.lane = ?
                      AND (${DENIED_INTENT_ORGANIZATION_SQL} = ?
                        OR ${DENIED_INTENT_ORGANIZATION_SQL} IS NULL)
                  )`
               : ""
           }`,
        [
          new Date().toISOString(),
          LOCAL_INTENT_LANES.documentPlacement,
          ...DOCUMENT_PLACEMENT_INTENT_TYPES,
          ...(input?.localId ? [input.localId] : []),
          ...(input?.organizationId
            ? [LOCAL_INTENT_LANES.documentPlacement, input.organizationId]
            : []),
        ],
      );
    });
  },
};
