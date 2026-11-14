import { and, desc, eq, or } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../../documents/documentConstants";
import { deriveStableDocumentId } from "../../../documents/shared/stableDocumentId";
import {
  documentHistoryCheckpoints,
  documents,
} from "../../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../sqlite/sqlSchema";
import { insertDocumentPendingUpdateWithHistoryInTransaction } from "../records/documentPendingUpdatePersistence";
import type { DocumentsPersistence } from "../types";
import {
  createDocumentRowsIfAbsent,
  resolveDocumentSaveTimestamp,
} from "./documentRows";

function classifyExistingBirth(
  requestedLocalId: string,
  requestedDocumentId: string,
  existingLocalId: string,
) {
  if (existingLocalId === requestedLocalId) return null;
  return {
    status: "remote-alias" as const,
    documentId: requestedDocumentId,
    localId: existingLocalId,
  };
}

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
): ReturnType<DocumentsPersistence["createDocumentWithHistoryCheckpoint"]> {
  const requestedDocumentId =
    document.documentId ?? (await deriveStableDocumentId(document.id));
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        const updatedAt = await resolveDocumentSaveTimestamp({
          document,
          options,
          tx,
        });
        if (options?.stillCurrent && !options.stillCurrent()) {
          return null;
        }
        // Check under the same immediate transaction as the birth. A lookup
        // before entering it misses discovery committed while creation waits.
        // Prefer an existing local winner so its normal restore path survives.
        const [existing] = await tx
          .select({ localId: documents.localId })
          .from(documents)
          .where(
            and(
              eq(documents.appKind, DOCUMENTS_APP_KIND),
              or(
                eq(documents.localId, document.id),
                eq(documents.documentId, requestedDocumentId),
              ),
            ),
          )
          .orderBy(desc(eq(documents.localId, document.id)))
          .limit(1);
        if (existing) {
          return classifyExistingBirth(
            document.id,
            requestedDocumentId,
            existing.localId,
          );
        }
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
