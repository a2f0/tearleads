import type { SecurityIncidents } from "@tearleads/client-sdk";
import { DocumentPurgeCheckpointConflictError } from "./terminalSecurityAnchorBackupMerge";

export type SecurityIncidentRecordingStatus = Awaited<
  ReturnType<SecurityIncidents["record"]>
>;

export interface PurgeCheckpointConflict {
  readonly conflict: DocumentPurgeCheckpointConflictError;
  /** Attachment bytes the failed restore overwrote and could not put back. */
  readonly rollbackFailures: ReadonlyArray<unknown>;
}

/**
 * A restore refused on equivocation evidence, after the conflict was offered
 * to the live incident ledger. `recording` says where that report ended up so
 * the host claims a recorded incident only when the row is durable, and
 * `rollbackFailures` says which blob rollbacks left the device changed.
 */
export class BackupRestoreConflictError extends Error {
  readonly conflict: DocumentPurgeCheckpointConflictError;
  readonly recording: SecurityIncidentRecordingStatus;
  readonly rollbackFailures: ReadonlyArray<unknown>;

  constructor(
    input: PurgeCheckpointConflict & {
      readonly cause: unknown;
      readonly recording: SecurityIncidentRecordingStatus;
    },
  ) {
    super(input.conflict.message, { cause: input.cause });
    this.name = "BackupRestoreConflictError";
    this.conflict = input.conflict;
    this.recording = input.recording;
    this.rollbackFailures = input.rollbackFailures;
  }
}

/**
 * The restore raises the conflict bare, or inside the `AggregateError` it
 * builds when blob rollback also failed; the other members are those failures.
 */
export function purgeCheckpointConflict(
  error: unknown,
): PurgeCheckpointConflict | null {
  const candidates: unknown[] =
    error instanceof AggregateError ? error.errors : [error];
  const conflict = candidates.find(
    (candidate): candidate is DocumentPurgeCheckpointConflictError =>
      candidate instanceof DocumentPurgeCheckpointConflictError,
  );
  if (!conflict) return null;
  return {
    conflict,
    rollbackFailures: candidates.filter((candidate) => candidate !== conflict),
  };
}
