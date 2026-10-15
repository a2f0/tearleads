import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelTables, principalPolicyTables } from "./schema";
import { ensureSqlTables } from "./sqlTableSchema";

test("SDK principal epoch records round-trip the exact integer range", async () => {
  const { close, execSql } = await createTestExecSql("principal-epoch-storage");
  try {
    await ensureSqlTables(execSql, [
      ...principalPolicyTables,
      ...organizationReadModelTables,
    ]);
    // Numeric persistence fixtures, not purported signed genesis histories.
    await execSql(`INSERT INTO principal_policy_bundle_references
      (principal_type, principal_id, version, state_hash, key_epoch,
       key_fingerprint, bundle_version, bundle_state_hash)
      VALUES ('group', 'group', 1, 'hash', 1, 'fingerprint', 1, 'hash')`);
    await execSql(`INSERT INTO organization_read_model_groups
      (organization_id, group_id, sort_order, name, created_at, is_builtin, key_epoch)
      VALUES ('org', 'group', 0, 'name', 'now', 0, 1)`);
    await execSql(`INSERT INTO organization_read_model_state
      (organization_id, cursor, member_group_id, member_group_state_hash,
       organization_state_hash, organization_state_version,
       organization_key_epoch, organization_key_fingerprint,
       organization_member_count, updated_at)
      VALUES ('org', 'cursor', 'members', 'hash', 'hash', 1, 1,
       'fingerprint', 1, 'now')`);
    const epochColumns: ReadonlyArray<readonly [string, string]> = [
      ["principal_policy_bundle_references", "key_epoch"],
      ["organization_read_model_groups", "key_epoch"],
      ["organization_read_model_state", "organization_key_epoch"],
    ];
    for (const [table, column] of epochColumns) {
      for (const epoch of [1, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
        await execSql(`UPDATE ${table} SET ${column} = ?`, [epoch]);
        const result = await execSql(`SELECT ${column} FROM ${table}`);
        expect(result).toEqual([{ [column]: epoch }]);
      }
    }
  } finally {
    close();
  }
});
