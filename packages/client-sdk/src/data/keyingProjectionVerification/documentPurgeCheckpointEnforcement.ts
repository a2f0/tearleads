import { KeyingVerificationError } from "@tearleads/crypto";
import { loadDocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

export async function rejectPurgedDocumentProjection(
  documentId: string,
  execSql: ExecSql,
): Promise<void> {
  if (await loadDocumentPurgeCheckpoint(execSql, documentId)) {
    throw new KeyingVerificationError(
      "rollback",
      "Document writer projection targets a permanently purged document",
    );
  }
}
