import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../../utils/sqlDialect";

export async function deriveDocumentLifecycleLockKeys(
  documentId: string,
): Promise<readonly [number, number]> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`document-lifecycle:${documentId.toLowerCase()}`),
  );
  const lockKeys = new DataView(digest);
  return [lockKeys.getInt32(0, false), lockKeys.getInt32(4, false)];
}

/**
 * Serialize create and terminal purge even while no document row or manifest
 * head exists. SQLite write transactions already serialize globally;
 * PostgreSQL needs a transaction-scoped lock whose identity survives deletion.
 */
export async function lockDocumentLifecycleInTransaction(
  tx: DatabaseTransaction,
  documentId: string,
): Promise<void> {
  if (isSqliteApiDatabase()) return;
  const [firstKey, secondKey] =
    await deriveDocumentLifecycleLockKeys(documentId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(${firstKey}, ${secondKey})`,
  );
}
