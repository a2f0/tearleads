import { keyingCheckpointTables } from "../../sqlite/schema/keyingCheckpointSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  accessManifestObjectKey,
  loadAccessManifestCheckpointRows,
} from "../keyingCheckpoints/keyingCheckpointPersistence";
import type { ContainerRecord } from "./containerPersistence";

type Placement = Pick<ContainerRecord, "id" | "organizationId">;

/** A folder's placement checkpoint can advance independently of its metadata. */
export async function readRemovalPlacementHeads(
  db: ClientSQLiteTransactionScope,
  folders: readonly Placement[],
) {
  const identities = folders.map(({ id, organizationId }) => ({
    objectId: id,
    organizationId,
    objectKind: "container" as const,
  }));
  const stored = await loadAccessManifestCheckpointRows(db, identities);
  return new Map(
    identities.map((identity) => [
      identity.objectId,
      stored.get(accessManifestObjectKey(identity))?.manifestHash ?? null,
    ]),
  );
}

export async function captureRemovalPlacementHeads(
  execSql: ExecSql,
  folders: readonly Placement[],
) {
  await ensureSqlTables(execSql, keyingCheckpointTables);
  return readRemovalPlacementHeads(
    getClientSQLitePersistenceRuntime(execSql).db,
    folders,
  );
}
