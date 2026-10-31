import { and, asc, eq, inArray, notInArray, or, type SQL } from "drizzle-orm";
import {
  documentContainerProjection,
  documentContainerProjectionTables,
  documentPlacementIntentTables,
  documentTables,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import { documentIntentLinkTargets } from "../../sqlite/schema/documentPlacementIntentSchema";
import {
  REMOTE_RESET_SQL_BATCH_SIZE,
  remoteResetBatches,
  SQLITE_BOUND_VARIABLE_BUDGET,
  sqliteInsertBatchSize,
} from "../../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  deleteContainerDocumentTombstoneHoldRowsForLinks,
  deleteContainerDocumentTombstoneHoldsForContainers,
  deleteContainerDocumentTombstoneHoldsForDocuments,
  placementPairsMatch,
} from "../documents/containerDocumentTombstoneHoldsPersistence";

import {
  type DocumentPlacementInput,
  type DocumentPlacementWriteOptions,
  filterWritableDocumentPlacements,
} from "./documentPlacement";

const LINK_INSERT_BATCH_SIZE = sqliteInsertBatchSize(
  documentContainerProjection,
);

interface DocumentContainerProjectionPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  listLinkedContainerIds: (
    execSql: ExecSql,
    documentId: string,
  ) => Promise<ReadonlyArray<string>>;
  listLinkedContainerIdsByDocumentIds: (
    execSql: ExecSql,
    documentIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyMap<string, ReadonlyArray<string>>>;
  listDocumentIdsByContainerIds: (
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<string>>;
  replaceDocumentLinks: (
    execSql: ExecSql,
    documentId: string,
    containerIds: ReadonlyArray<string>,
    options?: DocumentPlacementWriteOptions,
  ) => Promise<void>;
  replaceDocumentLinksBatch: (
    execSql: ExecSql,
    inputs: ReadonlyArray<DocumentPlacementInput>,
    options?: DocumentPlacementWriteOptions,
  ) => Promise<void>;
}

/** Link rows and their tombstone holds leave together on a remote reset. */
export async function deleteDocumentPlacementRowsByContainerIds(
  tx: ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
): Promise<void> {
  await tx
    .delete(documentContainerProjection)
    .where(inArray(documentContainerProjection.containerId, containerIds))
    .run();
  await deleteContainerDocumentTombstoneHoldsForContainers(tx, containerIds);
}

export async function deleteDocumentPlacementRowsByDocumentIds(
  tx: ClientSQLiteTransactionScope,
  documentIds: ReadonlyArray<string>,
): Promise<void> {
  await tx
    .delete(documentContainerProjection)
    .where(inArray(documentContainerProjection.documentId, documentIds))
    .run();
  await deleteContainerDocumentTombstoneHoldsForDocuments(tx, documentIds);
}

/** Removes the listed (document, container) placements, 50 pairs per statement. */
export async function deleteDocumentPlacementRowsInTransaction(
  tx: ClientSQLiteTransactionScope,
  placements: ReadonlyArray<{
    readonly containerId: string;
    readonly documentId: string;
  }>,
): Promise<void> {
  for (const batch of remoteResetBatches(placements)) {
    await tx
      .delete(documentContainerProjection)
      .where(
        placementPairsMatch(
          batch,
          documentContainerProjection.documentId,
          documentContainerProjection.containerId,
        ),
      )
      .run();
  }
}

/**
 * Removes each document's placements outside the containers its head links,
 * batching documents so one statement stays inside SQLite's bind budget.
 */
export async function deleteUnlinkedDocumentPlacementRowsInTransaction(
  tx: ClientSQLiteTransactionScope,
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<void> {
  let batch: SQL[] = [];
  let binds = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await tx
      .delete(documentContainerProjection)
      .where(or(...batch))
      .run();
    batch = [];
    binds = 0;
  };
  for (const [documentId, linked] of linkedContainerIdsByDocumentId) {
    // The document id plus one bind per linked container.
    const documentBinds = 1 + linked.size;
    if (
      batch.length >= REMOTE_RESET_SQL_BATCH_SIZE ||
      binds + documentBinds > SQLITE_BOUND_VARIABLE_BUDGET
    ) {
      await flush();
    }
    batch.push(unlinkedDocumentPlacementRows(documentId, linked));
    binds += documentBinds;
  }
  await flush();
}

/** A document's placements outside the containers its head links. */
function unlinkedDocumentPlacementRows(
  documentId: string,
  linkedContainerIds: ReadonlySet<string>,
): SQL {
  const ofDocument = eq(documentContainerProjection.documentId, documentId);
  return linkedContainerIds.size === 0
    ? ofDocument
    : (and(
        ofDocument,
        notInArray(documentContainerProjection.containerId, [
          ...linkedContainerIds,
        ]),
      ) ?? ofDocument);
}

/** Removes a deleted document's queued placement intents and link targets. */
export async function deleteDocumentPlacementIntentsInTransaction(
  tx: ClientSQLiteTransactionScope,
  documentId: string,
): Promise<void> {
  const placementIntent = and(
    inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
    eq(localIntents.subjectId, documentId),
  );
  await tx
    .delete(documentIntentLinkTargets)
    .where(
      inArray(
        documentIntentLinkTargets.intentId,
        tx
          .select({ id: localIntents.id })
          .from(localIntents)
          .where(placementIntent),
      ),
    )
    .run();
  await tx.delete(localIntents).where(placementIntent).run();
}

export const sqlDocumentContainerProjectionPersistence: DocumentContainerProjectionPersistence =
  {
    async ensureSchema(execSql) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
    },
    async listLinkedContainerIds(execSql, documentId) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
      const { db } = getClientSQLitePersistenceRuntime(execSql);
      const rows = await db
        .select({ containerId: documentContainerProjection.containerId })
        .from(documentContainerProjection)
        .where(eq(documentContainerProjection.documentId, documentId))
        .orderBy(asc(documentContainerProjection.containerId));

      return rows.map((row) => row.containerId);
    },
    async listLinkedContainerIdsByDocumentIds(execSql, documentIds) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
      const uniqueDocumentIds = Array.from(new Set(documentIds));
      if (uniqueDocumentIds.length === 0) {
        return new Map();
      }

      const { db } = getClientSQLitePersistenceRuntime(execSql);
      const rows = await db
        .select({
          documentId: documentContainerProjection.documentId,
          containerId: documentContainerProjection.containerId,
        })
        .from(documentContainerProjection)
        .where(
          inArray(documentContainerProjection.documentId, uniqueDocumentIds),
        )
        .orderBy(
          asc(documentContainerProjection.documentId),
          asc(documentContainerProjection.containerId),
        );

      const linkedContainerIdsByDocumentId = new Map<string, string[]>();
      for (const documentId of uniqueDocumentIds) {
        linkedContainerIdsByDocumentId.set(documentId, []);
      }

      for (const row of rows) {
        const linkedContainerIds =
          linkedContainerIdsByDocumentId.get(row.documentId) ?? [];
        linkedContainerIds.push(row.containerId);
        linkedContainerIdsByDocumentId.set(row.documentId, linkedContainerIds);
      }

      return linkedContainerIdsByDocumentId;
    },
    async listDocumentIdsByContainerIds(execSql, containerIds) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
      const uniqueContainerIds = Array.from(new Set(containerIds));
      if (uniqueContainerIds.length === 0) {
        return [];
      }

      const { db } = getClientSQLitePersistenceRuntime(execSql);
      const rows = await db
        .selectDistinct({ documentId: documentContainerProjection.documentId })
        .from(documentContainerProjection)
        .where(
          inArray(documentContainerProjection.containerId, uniqueContainerIds),
        )
        .orderBy(asc(documentContainerProjection.documentId));

      return rows.map((row) => row.documentId);
    },
    async replaceDocumentLinks(execSql, documentId, containerIds, options) {
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        execSql,
        [{ documentId, containerIds }],
        options,
      );
    },
    async replaceDocumentLinksBatch(execSql, inputs, options) {
      await ensureSqlTables(execSql, [
        ...documentContainerProjectionTables,
        ...documentPlacementIntentTables,
        ...documentTables,
      ]);
      const latest = new Map(inputs.map((input) => [input.documentId, input]));
      if (latest.size === 0) return;
      const runtime = getClientSQLitePersistenceRuntime(execSql);
      const replace = async (tx: ClientSQLiteTransactionScope) => {
        const writable = await filterWritableDocumentPlacements(
          tx,
          [...latest.values()],
          options,
        );
        if (writable.length === 0) return;
        // A placement the writer re-asserts is no longer tombstoned: a
        // listing that links it again, or a local move that owns it, releases
        // the hold so the document is not hidden until the next retry.
        if (options?.moveIntentId) {
          await deleteContainerDocumentTombstoneHoldsForDocuments(
            tx,
            writable.map((input) => input.documentId),
          );
        } else {
          await deleteContainerDocumentTombstoneHoldRowsForLinks(tx, writable);
        }
        await tx
          .delete(documentContainerProjection)
          .where(
            inArray(
              documentContainerProjection.documentId,
              writable.map((input) => input.documentId),
            ),
          )
          .run();
        const updatedAt = new Date().toISOString();
        const rows = writable.flatMap((input) =>
          Array.from(new Set(input.containerIds))
            .sort()
            .map((containerId) => ({
              documentId: input.documentId,
              containerId,
              updatedAt,
            })),
        );
        // A lane page of multi-link documents can carry more link rows than
        // one statement may bind.
        for (
          let index = 0;
          index < rows.length;
          index += LINK_INSERT_BATCH_SIZE
        ) {
          await tx
            .insert(documentContainerProjection)
            .values(rows.slice(index, index + LINK_INSERT_BATCH_SIZE))
            .run();
        }
      };
      if (options?.stillCurrent) {
        await runtime.guardedTransaction(replace, options.stillCurrent);
        return;
      }
      await runtime.transaction(replace);
    },
  };
