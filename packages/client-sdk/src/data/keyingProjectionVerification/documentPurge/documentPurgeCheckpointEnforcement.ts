import { KeyingVerificationError } from "@tearleads/crypto";
import { KeyingCheckpointRepository } from "../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import type { ExecSql } from "../../sqlite/sqlSchema";

export async function rejectPurgedDocumentProjection(
  documentId: string,
  execSql: ExecSql,
): Promise<void> {
  if (
    await new KeyingCheckpointRepository(execSql).loadDocumentPurgeCheckpoint(
      documentId,
    )
  ) {
    throw new KeyingVerificationError(
      "rollback",
      "Document writer projection targets a permanently purged document",
    );
  }
}
