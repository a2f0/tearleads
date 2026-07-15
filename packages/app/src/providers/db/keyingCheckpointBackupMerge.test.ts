import { expect, test } from "bun:test";
import {
  ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
  mergeAccessManifestCheckpointBackupTables,
  mergePrincipalPolicyCheckpointBackupTables,
  PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
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

const principalColumns = [
  "principal_type",
  "principal_id",
  "version",
  "state_hash",
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

function principalRow(overrides: Partial<BackupSqlRow> = {}): BackupSqlRow {
  return {
    principal_type: "group",
    principal_id: "group-1",
    version: 3,
    state_hash: HASH_A,
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

function principalTable(rows: ReadonlyArray<BackupSqlRow>): BackupTable {
  return {
    columns: principalColumns,
    name: PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
    rows,
    sql: "CREATE TABLE principal_policy_checkpoints (...) ",
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

test("principal checkpoint merge retains the highest version", () => {
  const current = principalRow();
  const older = principalRow({ version: 2, updated_at: RESTORED_TIME });
  const newer = principalRow({
    state_hash: HASH_B,
    updated_at: RESTORED_TIME,
    version: 4,
  });

  expect(
    mergePrincipalPolicyCheckpointBackupTables({
      current: principalTable([current]),
      restored: principalTable([older]),
    })?.rows,
  ).toEqual([current]);
  expect(
    mergePrincipalPolicyCheckpointBackupTables({
      current: principalTable([current]),
      restored: principalTable([newer]),
    })?.rows,
  ).toEqual([newer]);
});

test("principal checkpoint merge rejects same-version equivocation", () => {
  expect(() =>
    mergePrincipalPolicyCheckpointBackupTables({
      current: principalTable([principalRow()]),
      restored: principalTable([principalRow({ state_hash: HASH_B })]),
    }),
  ).toThrow("Backup conflicts with a principal policy checkpoint");
});

test("checkpoint merge preserves lazy missing-table semantics", () => {
  const access = accessTable([accessRow()]);
  const principal = principalTable([principalRow()]);

  expect(
    mergeAccessManifestCheckpointBackupTables({
      current: access,
      restored: null,
    }),
  ).toEqual(access);
  expect(
    mergePrincipalPolicyCheckpointBackupTables({
      current: null,
      restored: principal,
    }),
  ).toEqual(principal);
  expect(
    mergePrincipalPolicyCheckpointBackupTables({
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
  ).toThrow("Access manifest checkpoint backup columns are invalid");
  expect(() =>
    mergePrincipalPolicyCheckpointBackupTables({
      current: null,
      restored: principalTable([principalRow(), principalRow()]),
    }),
  ).toThrow("Principal policy checkpoint backup contains a duplicate scope");
  expect(() =>
    mergePrincipalPolicyCheckpointBackupTables({
      current: null,
      restored: principalTable([principalRow({ version: 0 })]),
    }),
  ).toThrow("Principal policy checkpoint backup has an invalid version value");
});
