import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import { defaultDocumentsPersistence } from "../persistence";

export async function hasVerifiedDocumentPurge(
  execSql: ExecSql,
  documentId: string,
  organizationId: string,
) {
  const checkpoint = await new KeyingCheckpointRepository(
    execSql,
  ).loadDocumentPurgeCheckpoint(documentId);
  if (checkpoint && checkpoint.organizationId !== organizationId)
    throw new Error("Purge checkpoint belongs to another organization.");
  return checkpoint !== null;
}

export function pinAbsentDocumentPurge(
  execSql: ExecSql,
  documentId: string,
  commitPurgeProof: (transaction: ExecSql) => Promise<void>,
) {
  return runSerializedSqlMutation(execSql, async (locked) => {
    await defaultDocumentsPersistence.ensureSchema(locked);
    await getClientSQLitePersistenceRuntime(locked).transaction(async () => {
      if (
        await defaultDocumentsPersistence.findLocalIdByDocumentId(
          locked,
          documentId,
        )
      ) {
        // The document store pins its proof alongside generation-guarded teardown.
        throw new Error("Sync the local document to apply its verified purge.");
      }
      await commitPurgeProof(locked);
    });
  });
}
