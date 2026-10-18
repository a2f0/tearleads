import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  readTableColumns,
  requireColumn,
} from "../../../../test/helpers/sqlitePragma";
import { ensureSqlTables } from "../sqlTableSchema";
import { organizationReadModelTables } from "./index";

test("organization read model schema folds policy and membership heads into rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-schema-test",
  );
  try {
    await ensureSqlTables(execSql, organizationReadModelTables);

    // Policy and membership heads fold into the catalog and state rows.
    const tables = await execSql(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tableNames = tables.map(({ name }) => name);
    expect(tableNames).not.toContain("organization_read_model_policy_heads");
    expect(tableNames).not.toContain(
      "organization_read_model_group_memberships",
    );

    const groups = await readTableColumns(
      execSql,
      "organization_read_model_groups",
    );
    for (const name of [
      "state_hash",
      "state_version",
      "key_epoch",
      "key_fingerprint",
      "member_count",
      "members_state_hash",
    ]) {
      expect(requireColumn(groups, name).notNull).toBe(0);
    }

    const state = await readTableColumns(
      execSql,
      "organization_read_model_state",
    );
    for (const name of [
      "member_group_state_hash",
      "organization_state_hash",
      "organization_state_version",
      "organization_key_epoch",
      "organization_key_fingerprint",
      "organization_member_count",
    ]) {
      expect(requireColumn(state, name).notNull).toBe(1);
    }

    const members = await readTableColumns(
      execSql,
      "organization_read_model_group_members",
    );
    // The member-kind column is gone, so the composite key is
    // (organizationId, groupId, userId) and userId sits third.
    expect(requireColumn(members, "user_id")).toMatchObject({
      notNull: 1,
      pk: 3,
    });
    // Member public keys are not repeated; the directory lane holds them.
    for (const name of [
      "signing_key_fingerprint",
      "signing_public_key",
      "encapsulation_public_key",
      "encapsulation_key_fingerprint",
    ]) {
      expect(name in members).toBe(false);
    }

    const grants = await readTableColumns(
      execSql,
      "organization_read_model_container_grants",
    );
    expect(requireColumn(grants, "organization_id")).toMatchObject({
      notNull: 1,
      pk: 1,
    });
    expect(requireColumn(grants, "container_id")).toMatchObject({
      notNull: 1,
      pk: 2,
    });
    expect(requireColumn(grants, "subject_type")).toMatchObject({
      notNull: 1,
      pk: 3,
    });
    expect(requireColumn(grants, "subject_id")).toMatchObject({
      notNull: 1,
      pk: 4,
    });
    expect(requireColumn(grants, "metadata_access_epoch")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });
    expect("organization_name" in grants).toBe(false);
  } finally {
    close();
  }
});
