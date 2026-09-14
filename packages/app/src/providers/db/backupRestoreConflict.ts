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
 * A restore refused because the backup's purge pin disagrees with the local
 * one, after the conflict was offered to the live incident ledger. `recording`
 * says where that report ended up so the host claims a recorded incident only
 * when the row is durable (`ledgerFailures` holds a rejection the ledger threw
 * instead of answering), and `rollbackFailures` says which blob rollbacks left
 * the device changed.
 */
export class BackupRestoreConflictError extends Error {
  readonly conflict: DocumentPurgeCheckpointConflictError;
  readonly ledgerFailures: ReadonlyArray<unknown>;
  readonly recording: SecurityIncidentRecordingStatus;
  readonly rollbackFailures: ReadonlyArray<unknown>;

  constructor(
    input: PurgeCheckpointConflict & {
      readonly cause: unknown;
      readonly ledgerFailures: ReadonlyArray<unknown>;
      readonly recording: SecurityIncidentRecordingStatus;
    },
  ) {
    super(input.conflict.message, { cause: input.cause });
    this.name = "BackupRestoreConflictError";
    this.conflict = input.conflict;
    this.ledgerFailures = input.ledgerFailures;
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
