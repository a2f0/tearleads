import { KeyingVerificationError } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  documentPurgeCheckpoints,
  keyingCheckpointTables,
} from "../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

export interface DocumentPurgeCheckpoint {
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly organizationId: string;
  readonly purgeEventHash: string;
}

export async function loadDocumentPurgeCheckpoint(
  execSql: ExecSql,
  documentId: string,
): Promise<DocumentPurgeCheckpoint | null> {
  await ensureSqlTables(execSql, keyingCheckpointTables);
  const [row] = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({
      documentId: documentPurgeCheckpoints.documentId,
      documentManifestHash: documentPurgeCheckpoints.documentManifestHash,
      organizationId: documentPurgeCheckpoints.organizationId,
      purgeEventHash: documentPurgeCheckpoints.purgeEventHash,
    })
    .from(documentPurgeCheckpoints)
    .where(eq(documentPurgeCheckpoints.documentId, documentId))
    .limit(1);
  return row ?? null;
}

export async function storeDocumentPurgeCheckpointInTransaction(
  tx: ClientSQLiteTransactionScope,
  checkpoint: DocumentPurgeCheckpoint,
  updatedAt: string,
): Promise<void> {
  const [stored] = await tx
    .select({
      documentManifestHash: documentPurgeCheckpoints.documentManifestHash,
      organizationId: documentPurgeCheckpoints.organizationId,
      purgeEventHash: documentPurgeCheckpoints.purgeEventHash,
    })
    .from(documentPurgeCheckpoints)
    .where(eq(documentPurgeCheckpoints.documentId, checkpoint.documentId))
    .limit(1);
  if (stored) {
    if (
      stored.documentManifestHash !== checkpoint.documentManifestHash ||
      stored.organizationId !== checkpoint.organizationId ||
      stored.purgeEventHash !== checkpoint.purgeEventHash
    ) {
      throw new KeyingVerificationError(
        "equivocation",
        "Document purge checkpoint conflicts with the verified terminal event",
      );
    }
    return;
  }
  await tx
    .insert(documentPurgeCheckpoints)
    .values({ ...checkpoint, updatedAt })
    .run();
}
