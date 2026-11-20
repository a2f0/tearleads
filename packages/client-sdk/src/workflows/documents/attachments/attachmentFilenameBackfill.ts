import { and, eq, exists, isNull, sql } from "drizzle-orm";
import { serializeDocumentAttachmentNames } from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { documentAttachmentBlobProjection } from "../../../data/sqlite/schema";
import { documentProjectionText } from "../../../data/sqlite/schema/documentProjectionSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import { restorePersistedDocumentContent } from "../historyContent";

// An upgrade leaves old projections NULL. Only restore documents that own a
// visible blob, once per document even when it has several attachment slots.
export async function backfillDocumentAttachmentNames(
  execSql: ExecSql,
): Promise<void> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const candidates = await db
    .select({ localId: documentProjectionText.localId })
    .from(documentProjectionText)
    .where(
      and(
        isNull(documentProjectionText.attachmentNames),
        exists(
          db
            .select({ one: sql`1` })
            .from(documentAttachmentBlobProjection)
            .where(
              and(
                eq(
                  documentAttachmentBlobProjection.localId,
                  documentProjectionText.localId,
                ),
                isNull(documentAttachmentBlobProjection.detachedAt),
              ),
            ),
        ),
      ),
    );
  for (const { localId } of candidates) {
    if (localId === null) continue;
    await runSerializedSqlMutation(execSql, (lockedExecSql) =>
      getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          const history = await sqlDocumentsPersistence.loadHistoryRestoreState(
            lockedExecSql,
            localId,
          );
          // An unreadable checkpoint cannot supply a filename. Other documents
          // still get theirs; a subsequent content save replaces this fallback.
          const doc = await restorePersistedDocumentContent(history).catch(
            () => null,
          );
          try {
            await tx
              .update(documentProjectionText)
              .set({
                attachmentNames: doc
                  ? serializeDocumentAttachmentNames(doc)
                  : "{}",
              })
              .where(
                and(
                  eq(documentProjectionText.localId, localId),
                  isNull(documentProjectionText.attachmentNames),
                ),
              );
          } finally {
            doc?.free();
          }
        },
        { behavior: "immediate" },
      ),
    );
  }
}
