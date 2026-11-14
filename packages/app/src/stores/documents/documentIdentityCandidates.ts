import {
  DOCUMENTS_APP_KIND,
  defaultDocumentsPersistence,
} from "@tearleads/client-sdk";
import {
  clientSQLiteSchema,
  type ExecSql,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

/** Narrow metadata candidates, never full document histories or field matches. */
export async function loadDocumentIdentityCandidates(
  execSql: ExecSql,
  documentId: string,
  localIds: readonly [string, string?],
) {
  await defaultDocumentsPersistence.ensureSchema(execSql);
  const { documents, documentProjection } = clientSQLiteSchema;
  const { db } = getSQLitePersistenceRuntime(execSql);
  return db
    .select({
      containerId: documentProjection.containerId,
      documentId: documents.documentId,
      localId: documents.localId,
      recoveryDocumentId: documents.recoveryDocumentId,
    })
    .from(documents)
    .leftJoin(
      documentProjection,
      eq(documentProjection.localId, documents.localId),
    )
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        or(
          inArray(
            documents.localId,
            localIds.filter((id): id is string => id !== undefined),
          ),
          eq(documents.documentId, documentId),
          and(
            isNull(documents.documentId),
            eq(documents.recoveryDocumentId, documentId),
          ),
        ),
      ),
    )
    .orderBy(desc(documentProjection.updatedAt), desc(documents.localId));
}
