import { asc, eq, inArray } from "drizzle-orm";
import { getAppDatabaseRuntime } from "../persistence/appDatabaseRuntime";
import {
  documentContainerProjection,
  documentContainerProjectionTables,
} from "../persistence/schema";
import { type ExecSql, ensureSqlTables } from "../persistence/sqlSchema";

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
  ) => Promise<void>;
  replaceDocumentLinksBatch: (
    execSql: ExecSql,
    inputs: ReadonlyArray<{
      documentId: string;
      containerIds: ReadonlyArray<string>;
    }>,
  ) => Promise<void>;
}

export const sqlDocumentContainerProjectionPersistence: DocumentContainerProjectionPersistence =
  {
    async ensureSchema(execSql) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
    },
    async listLinkedContainerIds(execSql, documentId) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
      const { db } = getAppDatabaseRuntime(execSql);
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

      const { db } = getAppDatabaseRuntime(execSql);
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

      const { db } = getAppDatabaseRuntime(execSql);
      const rows = await db
        .selectDistinct({ documentId: documentContainerProjection.documentId })
        .from(documentContainerProjection)
        .where(
          inArray(documentContainerProjection.containerId, uniqueContainerIds),
        )
        .orderBy(asc(documentContainerProjection.documentId));

      return rows.map((row) => row.documentId);
    },
    async replaceDocumentLinks(execSql, documentId, containerIds) {
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        execSql,
        [{ documentId, containerIds }],
      );
    },
    async replaceDocumentLinksBatch(execSql, inputs) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
      const latestContainerIdsByDocumentId = new Map<
        string,
        ReadonlyArray<string>
      >();
      for (const input of inputs) {
        latestContainerIdsByDocumentId.set(
          input.documentId,
          input.containerIds,
        );
      }
      const documentIds = Array.from(latestContainerIdsByDocumentId.keys());
      if (documentIds.length === 0) {
        return;
      }

      const updatedAt = new Date().toISOString();
      const projectionRows = Array.from(
        latestContainerIdsByDocumentId.entries(),
      ).flatMap(([documentId, containerIds]) =>
        Array.from(new Set(containerIds))
          .sort()
          .map((containerId) => ({
            documentId,
            containerId,
            updatedAt,
          })),
      );

      await getAppDatabaseRuntime(execSql).transaction(async (tx) => {
        await tx
          .delete(documentContainerProjection)
          .where(inArray(documentContainerProjection.documentId, documentIds))
          .run();

        if (projectionRows.length > 0) {
          await tx
            .insert(documentContainerProjection)
            .values(projectionRows)
            .run();
        }
      });
    },
  };
