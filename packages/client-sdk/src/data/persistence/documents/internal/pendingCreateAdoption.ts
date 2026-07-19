import { and, eq, isNull } from "drizzle-orm";
import { deriveStableDocumentId } from "../../../documents/shared/stableDocumentId";
import { documents } from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { DOCUMENTS_APP_KIND } from "./constants";

/**
 * Maps the stable remote document id each pending-create row would have sent
 * to that row's localId. A remote create derives its document id from the
 * stable localId (deriveStableDocumentId), so when discovery lists a document
 * whose create this client committed but never saw the response for (e.g. a
 * reload mid-bootstrap), the orphaned row is recognizable by re-deriving the
 * id. Without this, discovery would mint a second row under localId=documentId
 * and the replayed create would adopt the same remote document onto the
 * original row — two local rows for one remote document.
 */
export async function mapPendingCreateLocalIds(
  execSql: ExecSql,
): Promise<ReadonlyMap<string, string>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        isNull(documents.documentId),
      ),
    );

  const localIdsByStableDocumentId = new Map<string, string>();
  for (const row of rows) {
    localIdsByStableDocumentId.set(
      await deriveStableDocumentId(row.localId),
      row.localId,
    );
  }
  return localIdsByStableDocumentId;
}
