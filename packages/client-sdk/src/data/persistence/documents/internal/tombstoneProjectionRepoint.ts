import { inArray, sql } from "drizzle-orm";
import { documentProjection } from "../../../sqlite/schema/documentProjectionSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";

interface ProjectionRepoint {
  readonly localId: string;
  readonly containerId: string | null;
  readonly updatedAt: string;
}

export async function repointTombstonedDocumentProjections(
  tx: ClientSQLiteTransactionScope,
  rows: ReadonlyArray<ProjectionRepoint>,
): Promise<void> {
  const batchSize = sqliteRowsPerStatement(5);
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    await tx
      .update(documentProjection)
      .set({
        containerId: sql`CASE ${documentProjection.localId} ${sql.join(
          batch.map((row) => sql`WHEN ${row.localId} THEN ${row.containerId}`),
          sql` `,
        )} END`,
        updatedAt: sql`CASE ${documentProjection.localId} ${sql.join(
          batch.map((row) => sql`WHEN ${row.localId} THEN ${row.updatedAt}`),
          sql` `,
        )} END`,
      })
      .where(
        inArray(
          documentProjection.localId,
          batch.map((row) => row.localId),
        ),
      )
      .run();
  }
}
