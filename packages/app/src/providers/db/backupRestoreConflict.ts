import type { SecurityIncidents } from "@tearleads/client-sdk";
import { DocumentPurgeCheckpointConflictError } from "./terminalSecurityAnchorBackupMerge";

export type SecurityIncidentRecordingStatus = Awaited<
  ReturnType<SecurityIncidents["record"]>
>;

/**
 * A restore refused on equivocation evidence, after the conflict was offered
 * to the live incident ledger. `recording` says where that report ended up so
 * the host claims a recorded incident only when the row is durable.
 */
export class BackupRestoreConflictError extends Error {
  readonly conflict: DocumentPurgeCheckpointConflictError;
  readonly recording: SecurityIncidentRecordingStatus;

  constructor(input: {
    readonly cause: unknown;
    readonly conflict: DocumentPurgeCheckpointConflictError;
    readonly recording: SecurityIncidentRecordingStatus;
  }) {
    super(input.conflict.message, { cause: input.cause });
    this.name = "BackupRestoreConflictError";
    this.conflict = input.conflict;
    this.recording = input.recording;
  }
}

export function purgeCheckpointConflict(
  error: unknown,
): DocumentPurgeCheckpointConflictError | null {
  const candidates: unknown[] =
    error instanceof AggregateError ? error.errors : [error];
  return (
    candidates.find(
      (candidate): candidate is DocumentPurgeCheckpointConflictError =>
        candidate instanceof DocumentPurgeCheckpointConflictError,
    ) ?? null
  );
}
