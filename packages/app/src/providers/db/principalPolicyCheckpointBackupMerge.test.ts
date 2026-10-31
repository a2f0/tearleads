import { expect, test } from "bun:test";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";
import {
  mergePrincipalPolicyCheckpointBackupTables,
  PRINCIPAL_POLICY_CHECKPOINT_COLUMNS,
  PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
} from "./principalPolicyCheckpointBackupMerge";

const CURRENT_TIME = "2026-07-15T12:00:00.000Z";
const RESTORED_TIME = "2026-07-01T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function pinned(overrides: Partial<BackupSqlRow> = {}): BackupSqlRow {
  return {
    principal_type: "group",
    principal_id: "group-1",
    organization_id: "org",
    version: 3,
    state_hash: HASH_A,
    updated_at: CURRENT_TIME,
    ...overrides,
  };
}

function owned(overrides: Partial<BackupSqlRow> = {}): BackupSqlRow {
  return pinned({
    version: null,
    state_hash: null,
    updated_at: null,
    ...overrides,
  });
}

function table(rows: ReadonlyArray<BackupSqlRow>): BackupTable {
  return {
    columns: PRINCIPAL_POLICY_CHECKPOINT_COLUMNS,
    name: PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
    rows,
    sql: "CREATE TABLE principal_policy_checkpoints (...) ",
  };
}

function merge(
  current: ReadonlyArray<BackupSqlRow> | null,
  restored: ReadonlyArray<BackupSqlRow> | null,
) {
  return mergePrincipalPolicyCheckpointBackupTables({
    current: current ? table(current) : null,
    restored: restored ? table(restored) : null,
  })?.rows;
}

test("principal checkpoint merge retains the highest version", () => {
  const current = pinned();
  const older = pinned({ version: 2, updated_at: RESTORED_TIME });
  const newer = pinned({
    state_hash: HASH_B,
    updated_at: RESTORED_TIME,
    version: 4,
  });
  expect(merge([current], [older])).toEqual([current]);
  expect(merge([current], [newer])).toEqual([newer]);
  expect(merge([current], [pinned({ updated_at: RESTORED_TIME })])).toEqual([
    current,
  ]);
});

test("principal checkpoint merge rejects same-version equivocation", () => {
  expect(() => merge([pinned()], [pinned({ state_hash: HASH_B })])).toThrow(
    "Backup conflicts with a principal policy checkpoint",
  );
});

test("an owned-only row never clears a pin, and a pin fills an owned-only row", () => {
  expect(merge([pinned()], [owned()])).toEqual([pinned()]);
  expect(merge([owned()], [pinned()])).toEqual([pinned()]);
  expect(merge([owned()], [owned()])).toEqual([owned()]);
});

test("the merge retains overlap once and imports backup-only principals", () => {
  const imported = owned({ principal_id: "backup-only" });
  expect(merge([pinned()], [pinned(), imported])).toEqual([pinned(), imported]);
});

test.each([
  ["pinned", pinned({ version: 4 })],
  ["owned only", owned()],
])("another owner refuses the restore (%s)", (_kind, restored) => {
  expect(() =>
    merge([pinned()], [{ ...restored, organization_id: "other-org" }]),
  ).toThrow("Backup conflicts with principal policy organization ownership");
});

test("checkpoint merge preserves lazy missing-table semantics", () => {
  expect(merge(null, [pinned()])).toEqual([pinned()]);
  expect(merge([pinned()], null)).toEqual([pinned()]);
  expect(merge(null, null)).toBeUndefined();
});

test.each([
  { rows: [pinned(), pinned()] },
  { rows: [pinned({ principal_type: "user" })] },
  { rows: [pinned({ organization_id: "" })] },
  { rows: [pinned({ organization_id: null })] },
  { rows: [pinned({ principal_type: "organization" })] },
  { rows: [pinned({ version: 0 })] },
  { rows: [pinned({ state_hash: null })] },
  { rows: [owned({ version: 1 })] },
  { rows: [owned({ updated_at: CURRENT_TIME })] },
])("restore refuses invalid, half-pinned or duplicated rows", ({ rows }) => {
  expect(() => merge(null, rows)).toThrow();
});

test("restore refuses a table without the owner column", () => {
  expect(() =>
    mergePrincipalPolicyCheckpointBackupTables({
      current: null,
      restored: {
        ...table([pinned()]),
        columns: PRINCIPAL_POLICY_CHECKPOINT_COLUMNS.filter(
          (column) => column !== "organization_id",
        ),
      },
    }),
  ).toThrow(
    "Principal policy checkpoint backup is missing the organization_id column",
  );
});
