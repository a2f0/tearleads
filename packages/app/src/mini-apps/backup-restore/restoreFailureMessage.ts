import { DocumentPurgeCheckpointConflictError } from "../../providers/db/terminalSecurityAnchorBackupMerge";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";

export function restoreFailureMessage(error: unknown): string {
  if (error instanceof DocumentPurgeCheckpointConflictError) {
    return `Restore refused: this backup carries a different purge proof for document ${error.documentId} than the one this device already verified. The conflict was recorded as a security incident and the local database was left unchanged.`;
  }
  return unknownErrorMessage(error);
}
