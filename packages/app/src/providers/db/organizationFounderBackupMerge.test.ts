import { expect, test } from "bun:test";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";
import {
  mergeOrganizationFounderBackupTables,
  ORGANIZATION_FOUNDER_COLUMNS,
  ORGANIZATION_FOUNDER_TABLE_NAME,
} from "./organizationFounderBackupMerge";

function table(rows: readonly BackupSqlRow[]): BackupTable {
  return {
    name: ORGANIZATION_FOUNDER_TABLE_NAME,
    columns: ORGANIZATION_FOUNDER_COLUMNS,
    rows,
    sql: "CREATE TABLE organization_founders (...)",
  };
}
const founder = {
  organization_id: "old-organization",
  user_id: "founder",
  signing_key_fingerprint: "founder-key",
  genesis_state_hash: "genesis",
};

test("restore retains founder bindings absent from a backup", () => {
  expect(
    mergeOrganizationFounderBackupTables({
      current: table([founder]),
      restored: null,
    })?.rows,
  ).toEqual([founder]);
  const next = { ...founder, organization_id: "replacement-organization" };
  expect(
    mergeOrganizationFounderBackupTables({
      current: table([founder]),
      restored: table([next]),
    })?.rows,
  ).toEqual([founder, next]);
});

test.each([
  "user_id",
  "signing_key_fingerprint",
  "genesis_state_hash",
] as const)("restore rejects a conflicting founder %s", (column) => {
  expect(() =>
    mergeOrganizationFounderBackupTables({
      current: table([founder]),
      restored: table([{ ...founder, [column]: "substitution" }]),
    }),
  ).toThrow("pinned founder");
});
