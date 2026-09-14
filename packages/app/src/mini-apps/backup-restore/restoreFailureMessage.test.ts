import { expect, test } from "bun:test";
import { BackupRestoreConflictError } from "../../providers/db/backupRestoreConflict";
import { DocumentPurgeCheckpointConflictError } from "../../providers/db/terminalSecurityAnchorBackupMerge";
import { restoreFailureMessage } from "./restoreFailureMessage";

const row = {
  document_id: "document-1",
  organization_id: "organization-1",
  document_manifest_hash: "a".repeat(64),
  purge_event_hash: "b".repeat(64),
  updated_at: "2026-09-12T12:00:00.000Z",
};
const conflict = new DocumentPurgeCheckpointConflictError(row, {
  ...row,
  purge_event_hash: "c".repeat(64),
});
const REFUSAL =
  "Restore refused: this backup disagrees with this device's purge record for document document-1.";

test("a purge checkpoint conflict tells the user what was refused and recorded", () => {
  const error = new BackupRestoreConflictError({
    cause: conflict,
    conflict,
    ledgerFailures: [],
    recording: "recorded",
    rollbackFailures: [],
  });
  expect(restoreFailureMessage(error)).toBe(
    `${REFUSAL} The conflict was recorded as a security incident and the local database was left unchanged.`,
  );
  expect(restoreFailureMessage(new Error("Backup password is incorrect"))).toBe(
    "Backup password is incorrect",
  );
});

test("a conflict whose incident did not reach the ledger does not claim it was recorded", () => {
  expect(
    restoreFailureMessage(
      new BackupRestoreConflictError({
        cause: conflict,
        conflict,
        ledgerFailures: [],
        recording: "failed",
        rollbackFailures: [],
      }),
    ),
  ).toBe(
    `${REFUSAL} The conflict could not be recorded as a security incident and the local database was left unchanged.`,
  );
  expect(
    restoreFailureMessage(
      new BackupRestoreConflictError({
        cause: conflict,
        conflict,
        ledgerFailures: [],
        recording: "buffered",
        rollbackFailures: [],
      }),
    ),
  ).toBe(
    `${REFUSAL} The conflict is waiting to be recorded as a security incident (the ledger write will be retried) and the local database was left unchanged.`,
  );
  // The bare merge error never reaches the UI; only the recorded envelope does.
  expect(restoreFailureMessage(conflict)).toBe(conflict.message);
});

test("a conflict that also left attachment bytes unrolled names the rollback failure", () => {
  const rollbackFailure = new Error("blob store offline");
  const aggregate = new AggregateError(
    [conflict, rollbackFailure],
    "Backup restore failed and 1 blob rollback operation(s) failed",
  );
  expect(
    restoreFailureMessage(
      new BackupRestoreConflictError({
        cause: aggregate,
        conflict,
        ledgerFailures: [],
        recording: "recorded",
        rollbackFailures: [rollbackFailure],
      }),
    ),
  ).toBe(
    `${REFUSAL} The conflict was recorded as a security incident and the local database was left unchanged. 1 restored attachment blob(s) could not be rolled back and still hold the backup's bytes.`,
  );
});
