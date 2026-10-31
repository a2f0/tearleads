import { expect, test } from "bun:test";
import {
  ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
  mergeAccessManifestCheckpointBackupTables,
} from "./keyingCheckpointBackupMerge";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";

const CURRENT_TIME = "2026-07-15T12:00:00.000Z";
const RESTORED_TIME = "2026-07-01T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const accessColumns = [
  "object_kind",
  "organization_id",
  "object_id",
  "epoch",
  "manifest_hash",
  "updated_at",
] as const;

function accessRow(overrides: Partial<BackupSqlRow> = {}): BackupSqlRow {
  return {
    object_kind: "document",
    organization_id: "organization-1",
    object_id: "document-1",
    epoch: 3,
    manifest_hash: HASH_A,
    updated_at: CURRENT_TIME,
    ...overrides,
  };
}

function accessTable(rows: ReadonlyArray<BackupSqlRow>): BackupTable {
  return {
    columns: accessColumns,
    name: ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
    rows,
    sql: "CREATE TABLE access_manifest_checkpoints (...) ",
  };
}

test("access checkpoint merge retains the highest epoch", () => {
  const current = accessRow();
  const older = accessRow({ epoch: 2, updated_at: RESTORED_TIME });
  const newer = accessRow({
    epoch: 4,
    manifest_hash: HASH_B,
    updated_at: RESTORED_TIME,
  });

  expect(
    mergeAccessManifestCheckpointBackupTables({
      current: accessTable([current]),
      restored: accessTable([older]),
    })?.rows,
  ).toEqual([current]);
  expect(
    mergeAccessManifestCheckpointBackupTables({
      current: accessTable([current]),
      restored: accessTable([newer]),
    })?.rows,
  ).toEqual([newer]);
});

test("access checkpoint merge keeps the current row on an exact tie", () => {
  const current = accessRow();
  const restored = accessRow({ updated_at: RESTORED_TIME });

  expect(
    mergeAccessManifestCheckpointBackupTables({
      current: accessTable([current]),
      restored: accessTable([restored]),
    })?.rows,
  ).toEqual([current]);
});

test("access checkpoint merge rejects same-epoch equivocation", () => {
  expect(() =>
    mergeAccessManifestCheckpointBackupTables({
      current: accessTable([accessRow()]),
      restored: accessTable([accessRow({ manifest_hash: HASH_B })]),
    }),
  ).toThrow("Backup conflicts with an access manifest checkpoint");
});

test("checkpoint merge preserves lazy missing-table semantics", () => {
  const access = accessTable([accessRow()]);

  expect(
    mergeAccessManifestCheckpointBackupTables({
      current: access,
      restored: null,
    }),
  ).toEqual(access);
  expect(
    mergeAccessManifestCheckpointBackupTables({
      current: null,
      restored: null,
    }),
  ).toBeNull();
});

test("checkpoint merge rejects malformed and duplicate restored rows", () => {
  expect(() =>
    mergeAccessManifestCheckpointBackupTables({
      current: null,
      restored: {
        ...accessTable([accessRow()]),
        columns: accessColumns.filter((column) => column !== "manifest_hash"),
      },
    }),
  ).toThrow(
    "Access manifest checkpoint backup is missing the manifest_hash column",
  );
});
