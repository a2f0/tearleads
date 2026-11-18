import { and, eq, inArray } from "drizzle-orm";
import { containers } from "../../sqlite/schema";
import {
  accessManifestCheckpoints,
  keyingCheckpointTables,
} from "../../sqlite/schema/keyingCheckpointSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { containerRemovalBatches } from "./containerRemovalBatches";

/** The signed folder placement may advance independently of the metadata
 * document. Match only the checkpoint in the local folder's organization. */
export async function readRemovalPlacementHeads(
  db: Pick<ClientSQLiteTransactionScope, "select">,
  ids: readonly string[],
) {
  const heads = new Map<string, string>();
  for (const batch of containerRemovalBatches(ids)) {
    const rows = await db
      .select({
        id: containers.id,
        hash: accessManifestCheckpoints.manifestHash,
      })
      .from(containers)
      .innerJoin(
        accessManifestCheckpoints,
        and(
          eq(accessManifestCheckpoints.objectKind, "container"),
          eq(
            accessManifestCheckpoints.organizationId,
            containers.organizationId,
          ),
          eq(accessManifestCheckpoints.objectId, containers.id),
        ),
      )
      .where(inArray(containers.id, batch));
    for (const row of rows) if (row.id) heads.set(row.id, row.hash);
  }
  return heads;
}

export async function captureRemovalPlacementHeads(
  execSql: ExecSql,
  ids: readonly string[],
) {
  await ensureSqlTables(execSql, keyingCheckpointTables);
  return readRemovalPlacementHeads(
    getClientSQLitePersistenceRuntime(execSql).db,
    ids,
  );
}
