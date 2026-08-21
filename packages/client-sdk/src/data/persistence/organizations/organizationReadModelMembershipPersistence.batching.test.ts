import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { OrganizationReadModelGroupMembershipsResponse } from "@symcrypt/validators/response";
import { organizationReadModelTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../../sqlite/sqlSchema";
import { applyGroupMembershipsLane } from "./organizationReadModelMembershipPersistence";

const ORGANIZATION_ID = "organization-batching";
const SQLITE_VARIABLE_LIMIT = 999;
const GROUP_COUNT = 1_000;

function withVariableLimit(execSql: ExecSql): ExecSql {
  return createExecSql({
    async exec({ sql, bind, rowMode }) {
      if (Array.isArray(bind) && bind.length > SQLITE_VARIABLE_LIMIT) {
        throw new Error("Test SQLite variable limit exceeded");
      }
      if (rowMode === "array") {
        return { rows: await execSql(sql, bind, { rowMode: "array" }) };
      }
      if (rowMode === "object") {
        return { rows: await execSql(sql, bind, { rowMode: "object" }) };
      }
      return { rows: await execSql(sql, bind) };
    },
  });
}

function lane(
  groups: OrganizationReadModelGroupMembershipsResponse["groups"],
  deletedGroupIds: string[] = [],
): OrganizationReadModelGroupMembershipsResponse {
  return { organizationId: ORGANIZATION_ID, groups, deletedGroupIds };
}

test("wide membership head inserts and deletions are batched", async () => {
  const { close, execSql: testExecSql } = await createTestExecSql(
    "organization-membership-batching",
  );
  const execSql = withVariableLimit(testExecSql);
  const groupIds = Array.from(
    { length: GROUP_COUNT },
    (_, index) => `group-${index}`,
  );
  const groups = groupIds.map((groupId) => ({
    groupId,
    stateHash: `state-${groupId}`,
    members: [],
  }));
  try {
    await ensureSqlTables(execSql, organizationReadModelTables);
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    await runtime.transaction((tx) =>
      applyGroupMembershipsLane({
        lane: lane(groups),
        organizationId: ORGANIZATION_ID,
        replaceAll: true,
        tx,
      }),
    );

    const insertedRows = await execSql(
      "SELECT COUNT(*) FROM organization_read_model_group_memberships",
      undefined,
      { rowMode: "array" },
    );
    expect(insertedRows[0]?.[0]).toBe(GROUP_COUNT);

    await runtime.transaction((tx) =>
      applyGroupMembershipsLane({
        lane: lane([], groupIds),
        organizationId: ORGANIZATION_ID,
        replaceAll: false,
        tx,
      }),
    );
    const remainingRows = await execSql(
      "SELECT COUNT(*) FROM organization_read_model_group_memberships",
      undefined,
      { rowMode: "array" },
    );
    expect(remainingRows[0]?.[0]).toBe(0);
  } finally {
    close();
  }
});
