import { and, asc, eq, exists, gt, isNull, sql } from "drizzle-orm";
import { serializeDocumentAttachmentNames } from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { documentAttachmentBlobProjection } from "../../../data/sqlite/schema";
import { documentProjectionText } from "../../../data/sqlite/schema/documentProjectionSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { restorePersistedDocumentContent } from "../historyContent";

const BATCH_SIZE = 16;

async function restoreAttachmentNames(
  execSql: ExecSql,
  localId: string,
): Promise<boolean> {
  const projection = documentProjectionText;
  const history = await sqlDocumentsPersistence.loadHistoryRestoreState(
    execSql,
    localId,
  );
  // A missing or unreadable history may become available on a later pull.
  const doc = await restorePersistedDocumentContent(history).catch(() => null);
  if (!doc) return false;
  let attachmentNames: string;
  try {
    attachmentNames = serializeDocumentAttachmentNames(doc);
  } finally {
    doc.free();
  }
  // A concurrent document save already projected the authoritative names.
  await getClientSQLitePersistenceRuntime(execSql).runMutation((db) =>
    db
      .update(projection)
      .set({ attachmentNames })
      .where(
        and(
          eq(projection.localId, localId),
          isNull(projection.attachmentNames),
        ),
      ),
  );
  return true;
}

// A page supplies its document IDs. Filename searches also need the names of
// off-page references, so visit missing projections in bounded key order.
export async function backfillDocumentAttachmentNames(
  execSql: ExecSql,
  localIds?: readonly string[],
): Promise<boolean> {
  if (localIds?.length === 0) return false;
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const projection = documentProjectionText;
  const blob = documentAttachmentBlobProjection;
  // Bind a page's IDs as one value even when a shared blob has many references.
  const scope =
    localIds &&
    sql`${projection.localId} IN (SELECT value FROM json_each(${JSON.stringify(localIds)}))`;
  let after: string | undefined;
  let restored = false;
  for (;;) {
    const candidates: { localId: string | null }[] = await runtime.db
      .select({ localId: projection.localId })
      .from(projection)
      .where(
        and(
          isNull(projection.attachmentNames),
          scope,
          after === undefined ? undefined : gt(projection.localId, after),
          exists(
            runtime.db
              .select({ one: sql`1` })
              .from(blob)
              .where(
                and(
                  eq(blob.localId, projection.localId),
                  isNull(blob.detachedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(projection.localId))
      .limit(BATCH_SIZE);

    for (const { localId } of candidates) {
      if (localId === null) continue;
      after = localId;
      if (await restoreAttachmentNames(execSql, localId)) restored = true;
    }
    if (candidates.length < BATCH_SIZE) return restored;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
