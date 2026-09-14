import {
  BackupRestoreConflictError,
  type SecurityIncidentRecordingStatus,
} from "../../providers/db/backupRestoreConflict";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";

const RECORDING_OUTCOME: Record<SecurityIncidentRecordingStatus, string> = {
  buffered:
    "The conflict is waiting to be recorded as a security incident (the ledger write will be retried)",
  failed: "The conflict could not be recorded as a security incident",
  recorded: "The conflict was recorded as a security incident",
};

export function restoreFailureMessage(error: unknown): string {
  if (error instanceof BackupRestoreConflictError) {
    return `Restore refused: this backup carries a different purge proof for document ${error.conflict.documentId} than the one this device already verified. ${RECORDING_OUTCOME[error.recording]} and the local database was left unchanged.`;
  }
  return unknownErrorMessage(error);
}
