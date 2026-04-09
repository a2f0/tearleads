import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
  runSqlTransaction,
  type SqlTableSchema,
} from "./sqlSchema";

const documentContainerProjectionTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "document_container_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS document_container_projection (
        document_id TEXT NOT NULL,
        container_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (document_id, container_id)
      )
    `,
  },
];

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
      const rows = await execSql(
        `
          SELECT container_id
          FROM document_container_projection
          WHERE document_id = :documentId
          ORDER BY container_id ASC
        `,
        {
          ":documentId": documentId,
        },
      );

      return rows.map((row) =>
        String(readSqlRowValue(row, "container_id") ?? ""),
      );
    },
    async listLinkedContainerIdsByDocumentIds(execSql, documentIds) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
      const uniqueDocumentIds = Array.from(new Set(documentIds));
      if (uniqueDocumentIds.length === 0) {
        return new Map();
      }

      const bind: Record<string, string> = {};
      const placeholders = uniqueDocumentIds.map((documentId, index) => {
        const key = `:documentId${index}`;
        bind[key] = documentId;
        return key;
      });
      const rows = await execSql(
        `
          SELECT
            document_id,
            container_id
          FROM document_container_projection
          WHERE document_id IN (${placeholders.join(", ")})
          ORDER BY document_id ASC, container_id ASC
        `,
        bind,
      );

      const linkedContainerIdsByDocumentId = new Map<string, string[]>();
      for (const row of rows) {
        const documentId = String(readSqlRowValue(row, "document_id") ?? "");
        const containerId = String(readSqlRowValue(row, "container_id") ?? "");
        const linkedContainerIds =
          linkedContainerIdsByDocumentId.get(documentId) ?? [];
        linkedContainerIds.push(containerId);
        linkedContainerIdsByDocumentId.set(documentId, linkedContainerIds);
      }

      return linkedContainerIdsByDocumentId;
    },
    async replaceDocumentLinks(execSql, documentId, containerIds) {
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        execSql,
        [{ documentId, containerIds }],
      );
    },
    async replaceDocumentLinksBatch(execSql, inputs) {
      await ensureSqlTables(execSql, documentContainerProjectionTables);
      await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await runSqlTransaction(lockedExecSql, async () => {
          for (const input of inputs) {
            const uniqueContainerIds = Array.from(
              new Set(input.containerIds),
            ).sort();
            const updatedAt = new Date().toISOString();

            await lockedExecSql(
              `
                DELETE FROM document_container_projection
                WHERE document_id = :documentId
              `,
              {
                ":documentId": input.documentId,
              },
            );

            for (const containerId of uniqueContainerIds) {
              await lockedExecSql(
                `
                  INSERT INTO document_container_projection (
                    document_id,
                    container_id,
                    updated_at
                  )
                  VALUES (
                    :documentId,
                    :containerId,
                    :updatedAt
                  )
                `,
                {
                  ":documentId": input.documentId,
                  ":containerId": containerId,
                  ":updatedAt": updatedAt,
                },
              );
            }
          }
        });
      });
    },
  };
