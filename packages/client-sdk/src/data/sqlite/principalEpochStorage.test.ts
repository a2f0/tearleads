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
    await execSql(`INSERT INTO organization_read_model_policy_heads
      (organization_id, principal_type, principal_id, state_hash,
       state_version, key_epoch, key_fingerprint, member_count)
      VALUES ('org', 'group', 'group', 'hash', 1, 1, 'fingerprint', 1)`);
    for (const table of [
      "principal_policy_bundle_references",
      "organization_read_model_groups",
      "organization_read_model_policy_heads",
    ]) {
      for (const epoch of [1, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
        await execSql(`UPDATE ${table} SET key_epoch = ?`, [epoch]);
        const result = await execSql(`SELECT key_epoch FROM ${table}`);
        expect(result).toEqual([{ key_epoch: epoch }]);
      }
    }
  } finally {
    close();
  }
});
