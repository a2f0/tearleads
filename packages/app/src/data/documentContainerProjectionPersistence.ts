import {
  type ExecSql,
  ensureSqlTables,
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
    async replaceDocumentLinks(execSql, documentId, containerIds) {
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        execSql,
        [{ documentId, containerIds }],
      );
    },
    async replaceDocumentLinksBatch(execSql, inputs) {
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
