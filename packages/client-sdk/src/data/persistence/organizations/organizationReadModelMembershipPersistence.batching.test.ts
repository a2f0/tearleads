import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationReadModelGroupMembershipsResponse } from "@tearleads/validators/response";
import { organizationReadModelGroups } from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../../sqlite/sqlSchema";
import { applyGroupMembershipsLane } from "./organizationReadModelMembershipPersistence";

const ORGANIZATION_ID = "organization-batching";
const MEMBER_GROUP_ID = "members-group";
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

const HEAD_COUNT_SQL = `SELECT COUNT(*) FROM organization_read_model_groups
  WHERE members_state_hash IS NOT NULL`;

test("wide membership head writes and deletions are batched", async () => {
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
    await runtime.transaction(async (tx) => {
      for (let index = 0; index < GROUP_COUNT; index += 90) {
        await tx
          .insert(organizationReadModelGroups)
          .values(
            groupIds.slice(index, index + 90).map((groupId, sortOrder) => ({
              organizationId: ORGANIZATION_ID,
              groupId,
              sortOrder,
              name: groupId,
              createdAt: "2026-07-01T00:00:00.000Z",
              isBuiltin: false,
            })),
          )
          .run();
      }
    });
    const membersHead = await runtime.transaction((tx) =>
      applyGroupMembershipsLane({
        currentMemberGroupStateHash: null,
        lane: lane([
          ...groups,
          { groupId: MEMBER_GROUP_ID, stateHash: "members-state", members: [] },
        ]),
        memberGroupId: MEMBER_GROUP_ID,
        organizationId: ORGANIZATION_ID,
        replaceAll: true,
        tx,
      }),
    );
    expect(membersHead).toBe("members-state");

    const writtenHeads = await execSql(HEAD_COUNT_SQL, undefined, {
      rowMode: "array",
    });
    expect(writtenHeads[0]?.[0]).toBe(GROUP_COUNT);

    await runtime.transaction((tx) =>
      applyGroupMembershipsLane({
        currentMemberGroupStateHash: "members-state",
        lane: lane([], groupIds),
        memberGroupId: MEMBER_GROUP_ID,
        organizationId: ORGANIZATION_ID,
        replaceAll: false,
        tx,
      }),
    );
    const remainingHeads = await execSql(HEAD_COUNT_SQL, undefined, {
      rowMode: "array",
    });
    expect(remainingHeads[0]?.[0]).toBe(0);
  } finally {
    close();
  }
});
