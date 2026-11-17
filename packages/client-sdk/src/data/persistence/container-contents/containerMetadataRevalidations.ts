import { eq } from "drizzle-orm";
import { containerMetadataRevalidations } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureContainerTables } from "./containerPersistence";

/** Record that a container metadata document owes a remote read. */
export async function requestContainerMetadataRevalidation(
  execSql: ExecSql,
  documentId: string,
): Promise<void> {
  await ensureContainerTables(execSql);
  await getClientSQLitePersistenceRuntime(execSql)
    .db.insert(containerMetadataRevalidations)
    .values({ documentId, requestedAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
}

/** Metadata documents still owed a read, in id order. */
export async function listContainerMetadataRevalidations(
  execSql: ExecSql,
): Promise<readonly string[]> {
  await ensureContainerTables(execSql);
  const rows = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ documentId: containerMetadataRevalidations.documentId })
    .from(containerMetadataRevalidations)
    .orderBy(containerMetadataRevalidations.documentId);
  return rows.map(({ documentId }) => documentId);
}

/** The owed read completed. */
export async function settleContainerMetadataRevalidation(
  execSql: ExecSql,
  documentId: string,
): Promise<void> {
  await ensureContainerTables(execSql);
  await getClientSQLitePersistenceRuntime(execSql)
    .db.delete(containerMetadataRevalidations)
    .where(eq(containerMetadataRevalidations.documentId, documentId))
    .run();
}
