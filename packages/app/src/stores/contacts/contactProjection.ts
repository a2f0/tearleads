import { getDocumentClientProjectionTables } from "@tearleads/client-sdk";
import {
  type ExecSql,
  ensureSqlTables,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { eq } from "drizzle-orm";
import { contactProjection } from "../../document-projectors/contactClientProjection";
import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";

const contactProjectionSchemaPromises = new WeakMap<ExecSql, Promise<void>>();

function normalizeProjectionNullableText(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

async function dropLegacyContactProjectionIndexes(
  execSql: ExecSql,
): Promise<void> {
  await execSql('DROP INDEX IF EXISTS "contact_projection_self_idx"');
  await execSql('DROP INDEX IF EXISTS "contact_projection_user_idx"');
}

function ensureContactProjectionSchema(execSql: ExecSql): Promise<void> {
  const existingPromise = contactProjectionSchemaPromises.get(execSql);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = dropLegacyContactProjectionIndexes(execSql)
    .then(() =>
      ensureSqlTables(
        execSql,
        getDocumentClientProjectionTables(APP_DOCUMENT_PROJECTOR_DEFINITIONS),
      ),
    )
    .catch((error: unknown) => {
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
      firstName: contactProjection.firstName,
      isSelf: contactProjection.isSelf,
      lastName: contactProjection.lastName,
      localId: contactProjection.localId,
      nickname: contactProjection.nickname,
      userId: contactProjection.userId,
    })
    .from(contactProjection)
    .where(eq(contactProjection.containerId, containerId));

  return rows.map((row) => ({
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
