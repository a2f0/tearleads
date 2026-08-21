import {
  DOCUMENTS_APP_KIND,
  defaultDocumentsPersistence,
  getDocumentClientProjectionTables,
} from "@symcrypt/client-sdk";
import {
  clientSQLiteSchema,
  type ExecSql,
  ensureSqlTables,
  getSQLitePersistenceRuntime,
} from "@symcrypt/client-sdk/sqlite";
import { and, eq } from "drizzle-orm";
import { contactProjection } from "../../document-projectors/contactClientProjection";
import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";

const contactProjectionSchemaPromises = new WeakMap<ExecSql, Promise<void>>();

function normalizeProjectionNullableText(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

function ensureContactProjectionSchema(execSql: ExecSql): Promise<void> {
  const existingPromise = contactProjectionSchemaPromises.get(execSql);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await ensureSqlTables(
      execSql,
      getDocumentClientProjectionTables(APP_DOCUMENT_PROJECTOR_DEFINITIONS),
    );
  })().catch((error: unknown) => {
    contactProjectionSchemaPromises.delete(execSql);
    throw error;
  });
  contactProjectionSchemaPromises.set(execSql, promise);
  return promise;
}

export async function loadProjectedContacts(
  execSql: ExecSql,
  containerId: string,
): Promise<ContactEntry[]> {
  await ensureContactProjectionSchema(execSql);
  const { db } = getSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      encapsulationPublicKey: contactProjection.encapsulationPublicKey,
      effectiveAccessLevel: clientSQLiteSchema.documents.effectiveAccessLevel,
      firstName: contactProjection.firstName,
      isSelf: contactProjection.isSelf,
      lastName: contactProjection.lastName,
      localId: contactProjection.localId,
      nickname: contactProjection.nickname,
      userId: contactProjection.userId,
    })
    .from(contactProjection)
    .leftJoin(
      clientSQLiteSchema.documents,
      and(
        eq(clientSQLiteSchema.documents.appKind, DOCUMENTS_APP_KIND),
        eq(clientSQLiteSchema.documents.localId, contactProjection.localId),
      ),
    )
    .where(eq(contactProjection.containerId, containerId));

  return rows.map((row) => ({
    canWrite: row.effectiveAccessLevel !== "read",
    encapsulationPublicKey: normalizeProjectionNullableText(
      row.encapsulationPublicKey,
    ),
    firstName: row.firstName,
    id: row.localId,
    isSelf: row.isSelf === 1,
    lastName: row.lastName,
    nickname: row.nickname,
    userId: normalizeProjectionNullableText(row.userId),
  }));
}
