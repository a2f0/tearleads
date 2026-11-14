import {
  DOCUMENTS_APP_KIND,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import {
  clientSQLiteSchema,
  type ExecSql,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { and, eq, isNull, or } from "drizzle-orm";
import { getSelfContactLocalId } from "./selfContact";

export interface CurrentSelfContactIdentity {
  readonly documentId: string;
  readonly localId: string;
  readonly localIds: ReadonlySet<string>;
}

export async function loadCurrentSelfContactIdentity(
  execSql: ExecSql,
  fingerprint: string,
): Promise<CurrentSelfContactIdentity> {
  const localId = getSelfContactLocalId(fingerprint);
  const documentId = await deriveStableDocumentId(localId);
  await defaultDocumentsPersistence.ensureSchema(execSql);
  const { documents } = clientSQLiteSchema;
  const { db } = getSQLitePersistenceRuntime(execSql);
  const aliases = await db
    .select({
      documentId: documents.documentId,
      localId: documents.localId,
      recoveryDocumentId: documents.recoveryDocumentId,
    })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        or(
          eq(documents.localId, localId),
          eq(documents.documentId, documentId),
          and(
            isNull(documents.documentId),
            eq(documents.recoveryDocumentId, documentId),
          ),
        ),
      ),
    );
  const localIds = new Set([localId]);
  for (const alias of aliases) {
    // Persisted identity takes precedence over planned local birth identity.
    // Read the whole document namespace: an alias can live outside Contacts.
    const persistedId = alias.documentId ?? alias.recoveryDocumentId;
    if (persistedId === documentId || persistedId === null) {
      localIds.add(alias.localId);
    } else {
      localIds.delete(alias.localId);
    }
  }
  return {
    documentId,
    localId,
    localIds,
  };
}
