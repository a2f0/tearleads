import { containerTableSchemas } from "../../../src/data/sqlite/schema/containerSchema";
import {
  type ExecSql,
  ensureSqlTables,
} from "../../../src/data/sqlite/sqlSchema";

const STORED_AT = "2026-01-01T00:00:00.000Z";

/**
 * Stores a bare row for each container, which is all a document lane's row
 * needs: one is written only while its container is stored.
 */
export async function storeContainerRows(
  execSql: ExecSql,
  containerIds: Iterable<string>,
): Promise<void> {
  await ensureSqlTables(execSql, containerTableSchemas);
  for (const containerId of containerIds) {
    await execSql(
      `INSERT INTO containers (id, organization_id, local_created_at,
         local_updated_at) VALUES (?, 'organization', ?, ?)`,
      [containerId, STORED_AT, STORED_AT],
    );
  }
}
