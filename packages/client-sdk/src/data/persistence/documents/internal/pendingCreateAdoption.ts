import { and, eq, isNull } from "drizzle-orm";
import type { DocumentSummary } from "../../../documents/documentSummary";
import { deriveStableDocumentId } from "../../../documents/shared/stableDocumentId";
import { documentProjection, documents } from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { DOCUMENTS_APP_KIND } from "./constants";
import {
  documentSummaryJoin,
  documentSummarySelection,
  mapDocumentSummary,
} from "./documentProjectionRows";

/**
 * Maps the stable remote document id each pending-create row would have sent
 * to that row's localId. A remote create derives its document id from the
 * stable localId (deriveStableDocumentId), so when discovery lists a document
 * whose create this client committed but never saw the response for (e.g. a
 * reload mid-bootstrap), the orphaned row is recognizable by re-deriving the
 * id. Without this, discovery would mint a second row under localId=documentId
 * and the replayed create would adopt the same remote document onto the
 * original row — two local rows for one remote document.
 * This lookup prevents duplicates; discovery cannot authorize adoption. The
 * create retry must verify its signed container and organization scope first.
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

export async function loadPendingCreateSummary(
  execSql: ExecSql,
  localId: string | undefined,
): Promise<DocumentSummary | null> {
  if (!localId) return null;
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [row] = await db
    .select(documentSummarySelection)
    .from(documentProjection)
    .innerJoin(documents, documentSummaryJoin)
    .where(and(eq(documents.localId, localId), isNull(documents.documentId)))
    .limit(1);
  return row ? mapDocumentSummary(row) : null;
}
