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
  "Restore refused: this backup carries a different purge proof for document document-1 than the one this device already verified.";

test("a purge checkpoint conflict tells the user what was refused and recorded", () => {
  const error = new BackupRestoreConflictError({
    cause: conflict,
    conflict,
    recording: "recorded",
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
        recording: "failed",
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
        recording: "buffered",
      }),
    ),
  ).toBe(
    `${REFUSAL} The conflict is waiting to be recorded as a security incident (the ledger write will be retried) and the local database was left unchanged.`,
  );
  // The bare merge error never reaches the UI; only the recorded envelope does.
  expect(restoreFailureMessage(conflict)).toBe(conflict.message);
});
