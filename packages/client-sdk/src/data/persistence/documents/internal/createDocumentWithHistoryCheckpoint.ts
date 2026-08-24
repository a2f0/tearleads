import { insertDocumentPendingUpdateWithHistoryInTransaction } from "../../../sqlite/documentPendingUpdatePersistence";
import { documentHistoryCheckpoints } from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../sqlite/sqlSchema";
import type { DocumentsPersistence } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";
import {
  createDocumentRowsIfAbsent,
  resolveDocumentSaveTimestamp,
} from "./documentRows";

export async function createStoredDocumentWithHistoryCheckpoint(
  execSql: Parameters<
    DocumentsPersistence["createDocumentWithHistoryCheckpoint"]
  >[0],
  document: Parameters<
    DocumentsPersistence["createDocumentWithHistoryCheckpoint"]
  >[1],
  historyCheckpoint: Parameters<
    DocumentsPersistence["createDocumentWithHistoryCheckpoint"]
  >[2],
  options: Parameters<
    DocumentsPersistence["createDocumentWithHistoryCheckpoint"]
  >[3],
  saveClientProjection: Parameters<
    DocumentsPersistence["createDocumentWithHistoryCheckpoint"]
  >[4],
): Promise<string | null> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        const updatedAt = await resolveDocumentSaveTimestamp({
          document,
          options,
          tx,
        });
        const created = await createDocumentRowsIfAbsent({
          document,
          tx,
          updatedAt,
        });
        if (!created) return null;
        const revision = crypto.randomUUID();
        await tx
          .insert(documentHistoryCheckpoints)
          .values({
            appKind: DOCUMENTS_APP_KIND,
            localId: document.id,
            snapshot: historyCheckpoint.snapshot,
            endVersionVector: historyCheckpoint.endVersionVector,
            revision,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: [
              documentHistoryCheckpoints.appKind,
              documentHistoryCheckpoints.localId,
            ],
            set: {
              snapshot: historyCheckpoint.snapshot,
              endVersionVector: historyCheckpoint.endVersionVector,
              revision,
              updatedAt,
            },
          })
          .run();
        if (options?.pendingUpdate) {
          await insertDocumentPendingUpdateWithHistoryInTransaction({
            createdAt: new Date().toISOString(),
            pendingUpdate: options.pendingUpdate,
            scope: { appKind: DOCUMENTS_APP_KIND, localId: document.id },
            tx,
          });
        }
        await saveClientProjection(lockedExecSql, updatedAt);
        return updatedAt;
      },
      { behavior: "immediate" },
    ),
  );
}
