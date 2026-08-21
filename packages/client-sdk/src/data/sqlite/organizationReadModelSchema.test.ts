import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  readTableColumns,
  requireColumn,
} from "../../../test/helpers/sqlitePragma";
import { organizationReadModelTables } from "./schema";
import { ensureSqlTables } from "./sqlTableSchema";

test("organization read model schema stores exact policy heads and access lanes", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-schema-test",
  );
  try {
    await ensureSqlTables(execSql, organizationReadModelTables);

    const groups = await readTableColumns(
      execSql,
      "organization_read_model_groups",
    );
    expect("key_fingerprint" in groups).toBe(false);

    const policyHeads = await readTableColumns(
      execSql,
      "organization_read_model_policy_heads",
    );
    expect(requireColumn(policyHeads, "organization_id")).toMatchObject({
      notNull: 1,
      pk: 1,
    });
    expect(requireColumn(policyHeads, "principal_type")).toMatchObject({
      notNull: 1,
      pk: 2,
    });
    expect(requireColumn(policyHeads, "principal_id")).toMatchObject({
      notNull: 1,
      pk: 3,
    });
    for (const name of [
      "state_hash",
      "state_version",
      "key_epoch",
      "key_fingerprint",
      "member_count",
    ]) {
      expect(requireColumn(policyHeads, name).notNull).toBe(1);
    }

    const memberships = await readTableColumns(
      execSql,
      "organization_read_model_group_memberships",
    );
    expect(requireColumn(memberships, "group_id")).toMatchObject({
      notNull: 1,
      pk: 2,
    });
    expect(requireColumn(memberships, "state_hash")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });

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
