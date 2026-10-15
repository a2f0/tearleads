import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  OrganizationContainerGrantResponse,
  OrganizationReadModelGroupMembershipResponse,
  OrganizationReadModelSnapshotResponse,
} from "@tearleads/validators/response";
import { dataUsage } from "../../../../test/helpers/organizationReadModelFixtures";
import { organizationReadModelDirectoryUser } from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import { withSqliteBindBudget } from "../../../../test/helpers/sqliteBindBudgetGuard";
import {
  loadOrganizationDataUsageProjection,
  saveOrganizationDataUsageProjection,
} from "./organizationDataUsagePersistence";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

const ORGANIZATION_ID = "organization-capacity";
const MEMBER_GROUP_ID = "members-capacity";
const CREATED_AT = "2026-07-16T12:00:00.000Z";
// The feed is not paged and its lanes have no item ceiling, so a wide
// organization arrives as one page. These counts span several statements of
// every read-model insert and head update, and an active roster larger than
// the whole bound-variable budget.
const USER_COUNT = 1_100;
const GROUP_COUNT = 400;
const MEMBERS_PER_GROUP = 2;
const GRANT_COUNT = 200;

const userIds = Array.from({ length: USER_COUNT }, (_, i) => `user-${i}`);
const groupIds = Array.from({ length: GROUP_COUNT }, (_, i) => `group-${i}`);

function groupState(groupId: string, version: number) {
  return {
    stateHash: `state-${groupId}-${version}`,
    version,
    keyEpoch: version,
    keyFingerprint: `key-${groupId}-${version}`,
    memberCount: MEMBERS_PER_GROUP,
  };
}

function memberships(
  version: number,
): OrganizationReadModelGroupMembershipResponse[] {
  return [
    {
      groupId: MEMBER_GROUP_ID,
      stateHash: `members-state-${version}`,
      members: userIds.map((userId) => ({ role: "member", userId })),
    },
    ...groupIds.map((groupId, index) => ({
      groupId,
      stateHash: groupState(groupId, version).stateHash,
      members: userIds
        .slice(index % USER_COUNT, (index % USER_COUNT) + MEMBERS_PER_GROUP)
        .map((userId) => ({ role: "member" as const, userId })),
    })),
  ];
}

function grant(index: number): OrganizationContainerGrantResponse {
  const groupId = groupIds[index % GROUP_COUNT] ?? MEMBER_GROUP_ID;
  return {
    accessLevel: "read",
    containerId: `container-${index}`,
    createdAt: CREATED_AT,
    depth: 0,
    isBuiltin: false,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `manifest-${index}`,
    metadataDocumentId: `metadata-${index}`,
    parentId: null,
    updatedAt: CREATED_AT,
    subjectType: "group",
    subjectId: groupId,
    userId: null,
    signingKeyFingerprint: null,
    groupId,
  };
}

function wideDirectory(selfUserId: string, disabledUserId?: string) {
  return {
    organizationId: ORGANIZATION_ID,
    profileDocumentId: null,
    users: userIds.map((userId) =>
      organizationReadModelDirectoryUser(userId, {
        isSelf: userId === selfUserId,
        ...(userId === disabledUserId ? { status: "disabled" as const } : {}),
      }),
    ),
  };
}

function wideSnapshot(
  cursor: string,
  version: number,
  selfUserId = "user-0",
): OrganizationReadModelSnapshotResponse {
  return {
    version: 6,
    mode: "snapshot",
    organizationId: ORGANIZATION_ID,
    nextCursor: cursor,
    hasMore: false,
    currentUser: { isOrgAdmin: true },
    lanes: {
      directory: wideDirectory(selfUserId),
      grants: {
        organizationId: ORGANIZATION_ID,
        grants: Array.from({ length: GRANT_COUNT }, (_, i) => grant(i)),
      },
      groupMemberships: {
        organizationId: ORGANIZATION_ID,
        deletedGroupIds: [],
        groups: memberships(version),
      },
      groups: {
        organizationId: ORGANIZATION_ID,
        memberGroupId: MEMBER_GROUP_ID,
        groups: groupIds.map((groupId) => ({
          groupId,
          organizationId: ORGANIZATION_ID,
          createdAt: CREATED_AT,
          isBuiltin: false,
          currentState: groupState(groupId, version),
        })),
      },
      organizationPolicy: {
        organizationId: ORGANIZATION_ID,
        currentState: {
          stateHash: `organization-state-${version}`,
          version,
          keyEpoch: version,
          keyFingerprint: `organization-key-${version}`,
          memberCount: USER_COUNT,
        },
      },
    },
  };
}

test("a wide organization page persists within SQLite's bound-variable budget", async () => {
  const { close, execSql: testExecSql } = await createTestExecSql(
    "organization-read-model-capacity",
  );
  const execSql = withSqliteBindBudget(testExecSql);
  try {
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        execSql,
        requestedCursor: null,
        response: wideSnapshot("cursor-1", 1),
      }),
    ).resolves.toBe("applied");
    const { mode: _mode, ...replacement } = wideSnapshot("cursor-2", 2);
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        execSql,
        requestedCursor: "cursor-1",
        response: { ...replacement, mode: "delta" },
      }),
    ).resolves.toBe("applied");

    const projection = await loadOrganizationReadModelProjection(
      execSql,
      ORGANIZATION_ID,
      "user-0",
    );
    expect(projection?.cursor).toBe("cursor-2");
    expect(projection?.directory.users).toHaveLength(USER_COUNT);
    expect(projection?.groups.groups).toHaveLength(GROUP_COUNT);
    expect(projection?.groups.groups[0]?.currentState?.stateHash).toBe(
      "state-group-0-2",
    );
    expect(projection?.grants.grants).toHaveLength(GRANT_COUNT);
    expect(projection?.membershipEdges).toHaveLength(
      USER_COUNT + GROUP_COUNT * MEMBERS_PER_GROUP,
    );
  } finally {
    close();
  }
});

test("a wide roster prunes inactive requesters without binding the roster", async () => {
  const { close, execSql: testExecSql } = await createTestExecSql(
    "organization-read-model-wide-requester-prune",
  );
  const execSql = withSqliteBindBudget(testExecSql);
  try {
    // Each later identity joins the applied snapshot with its requester row.
    for (const currentUserId of ["user-0", "user-1", "user-2"]) {
      await applyOrganizationReadModelResponse({
        currentUserId,
        execSql,
        requestedCursor: null,
        response: wideSnapshot("cursor-1", 1, currentUserId),
      });
      await saveOrganizationDataUsageProjection({
        execSql,
        requesterUserId: currentUserId,
        response: { ...dataUsage, organizationId: ORGANIZATION_ID },
      });
    }

    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-0",
        execSql,
        requestedCursor: "cursor-1",
        response: {
          version: 6,
          mode: "delta",
          organizationId: ORGANIZATION_ID,
          nextCursor: "cursor-2",
          hasMore: false,
          currentUser: { isOrgAdmin: true },
          lanes: { directory: wideDirectory("user-0", "user-2") },
        },
      }),
    ).resolves.toBe("applied");

    // The disabled user's requester state falls; active users keep theirs.
    for (const [userId, retained] of [
      ["user-0", true],
      ["user-1", true],
      ["user-2", false],
    ] as const) {
      const projection = await loadOrganizationReadModelProjection(
        execSql,
        ORGANIZATION_ID,
        userId,
      );
      expect(projection?.requester !== null).toBe(retained);
      const usage = await loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        userId,
      );
      expect(usage !== null).toBe(retained);
    }
  } finally {
    close();
  }
});
