import { and, eq, inArray } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../sqlite/schema/documentAttachmentSchema";
import { documents } from "../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureDocumentsSchema } from "./internal/ensureDocumentsSchema";

/**
 * Whether this device's local view of a server document may include an active
 * attachment binding. It is false only when the device holds the document and
 * no attachment row names it: no held or downloaded copy, no slot detached
 * locally whose remote detach is still queued, and no pending upload. A
 * document the device does not hold as a `documents` record is answered true,
 * since it has no view.
 *
 * Callers may skip the server's attachment listing on false, because the
 * server re-checks the binding frontier at commit and refuses a stale view.
 */
export async function documentMayHaveAttachments(
  execSql: ExecSql,
  documentId: string,
): Promise<boolean> {
  await ensureDocumentsSchema(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const records = await db
    .select({ localId: documents.localId })
    .from(documents)
    // `documents_app_document_idx` serves this lookup. Other app kinds (a
    // container's metadata document) find no row and keep listing.
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.documentId, documentId),
      ),
    );
  if (records.length === 0) return true;
  const localIds = records.map((record) => record.localId);
  const [held] = await db
    .select({ localId: documentAttachmentBlobProjection.localId })
    .from(documentAttachmentBlobProjection)
    .where(inArray(documentAttachmentBlobProjection.localId, localIds))
    .limit(1);
  if (held) return true;
  const [pending] = await db
    .select({ localId: documentPendingAttachments.localId })
    .from(documentPendingAttachments)
    .where(inArray(documentPendingAttachments.localId, localIds))
    .limit(1);
  return pending !== undefined;
}
