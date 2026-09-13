import { expect, test } from "bun:test";
import { DocumentPurgeCheckpointConflictError } from "../../providers/db/terminalSecurityAnchorBackupMerge";
import { restoreFailureMessage } from "./restoreFailureMessage";

test("a purge checkpoint conflict tells the user what was refused and recorded", () => {
  const row = {
    document_id: "document-1",
    organization_id: "organization-1",
    document_manifest_hash: "a".repeat(64),
    purge_event_hash: "b".repeat(64),
    updated_at: "2026-09-12T12:00:00.000Z",
  };
  const error = new DocumentPurgeCheckpointConflictError(row, {
    ...row,
    purge_event_hash: "c".repeat(64),
  });
  expect(restoreFailureMessage(error)).toBe(
    "Restore refused: this backup carries a different purge proof for document document-1 than the one this device already verified. The conflict was recorded as a security incident and the local database was left unchanged.",
  );
  expect(restoreFailureMessage(new Error("Backup password is incorrect"))).toBe(
    "Backup password is incorrect",
  );
});
