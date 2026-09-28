import { expect, test } from "bun:test";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";
import {
  mergePrincipalPolicyOwnerBackupTables,
  PRINCIPAL_POLICY_OWNER_COLUMNS,
  PRINCIPAL_POLICY_OWNER_TABLE_NAME,
} from "./principalPolicyOwnerBackupMerge";

const row: BackupSqlRow = {
  principal_type: "group",
  principal_id: "group",
  organization_id: "org",
};
const table: BackupTable = {
  name: PRINCIPAL_POLICY_OWNER_TABLE_NAME,
  columns: PRINCIPAL_POLICY_OWNER_COLUMNS,
  rows: [row],
  sql: "CREATE TABLE principal_policy_organizations (...) ",
};

test.each([
  { rows: [row, row] },
  { rows: [{ ...row, principal_type: "user" }] },
  { rows: [{ ...row, organization_id: "" }] },
  { rows: [{ ...row, principal_type: "organization" }] },
])("restore refuses invalid or duplicated principal ownership", ({ rows }) => {
  expect(() =>
    mergePrincipalPolicyOwnerBackupTables({
      current: null,
      restored: { ...table, rows },
    }),
  ).toThrow();
});
