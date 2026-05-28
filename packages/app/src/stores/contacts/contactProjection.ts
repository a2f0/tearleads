import { getDocumentClientProjectionTables } from "@tearleads/client-sdk";
import {
  type ExecSql,
  ensureSqlTables,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { eq } from "drizzle-orm";
import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  contactProjection,
} from "../../document-types/projectors";

function normalizeProjectionNullableText(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

async function ensureContactProjectionSchema(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(
    execSql,
    getDocumentClientProjectionTables(APP_DOCUMENT_PROJECTOR_DEFINITIONS),
  );
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
