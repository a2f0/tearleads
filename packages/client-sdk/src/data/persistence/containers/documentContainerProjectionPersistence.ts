import { asc, eq, inArray } from "drizzle-orm";
import {
  containerDocumentTombstoneHolds,
  documentContainerProjection,
  documentContainerProjectionTables,
  documentMoveIntentTables,
  documentTables,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

import {
  type DocumentPlacementInput,
  type DocumentPlacementWriteOptions,
  filterWritableDocumentPlacements,
} from "./documentPlacement";

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
  await tx
    .delete(containerDocumentTombstoneHolds)
    .where(inArray(containerDocumentTombstoneHolds.containerId, containerIds))
    .run();
}

export async function deleteDocumentPlacementRowsByDocumentIds(
  tx: ClientSQLiteTransactionScope,
  documentIds: ReadonlyArray<string>,
): Promise<void> {
  await tx
    .delete(documentContainerProjection)
    .where(inArray(documentContainerProjection.documentId, documentIds))
    .run();
  await tx
    .delete(containerDocumentTombstoneHolds)
    .where(inArray(containerDocumentTombstoneHolds.documentId, documentIds))
    .run();
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
        ...documentMoveIntentTables,
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
        if (rows.length > 0)
          await tx.insert(documentContainerProjection).values(rows).run();
      };
      if (options?.stillCurrent) {
        await runtime.guardedTransaction(replace, options.stillCurrent);
        return;
      }
      await runtime.transaction(replace);
    },
  };
