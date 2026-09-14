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

function rollbackOutcome(failures: ReadonlyArray<unknown>): string {
  return failures.length === 0
    ? ""
    : ` ${failures.length} restored attachment blob(s) could not be rolled back and still hold the backup's bytes.`;
}

export function restoreFailureMessage(error: unknown): string {
  if (error instanceof BackupRestoreConflictError) {
    return `Restore refused: this backup disagrees with this device's purge record for document ${error.conflict.documentId}. ${RECORDING_OUTCOME[error.recording]} and the local database was left unchanged.${rollbackOutcome(error.rollbackFailures)}`;
  }
  return unknownErrorMessage(error);
}
