import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupMemberResponse,
  OrganizationReadModelDeltaResponse,
  OrganizationReadModelGroupMembershipResponse,
  OrganizationReadModelGroupMembershipsResponse,
  OrganizationReadModelOrganizationPolicyResponse,
  OrganizationReadModelSnapshotResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { loadPrincipalPolicyCheckpoint } from "../keyingCheckpointPersistence";
import { loadOrganizationReadModelGroupMembers } from "./organizationReadModelMemberLoad";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
  purgeOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

const CREATED_AT = "2026-07-17T12:00:00.000Z";
const ORGANIZATION_ID = "organization-v4";
const ADMINS_GROUP_ID = "admins-v4";
const EMPTY_GROUP_ID = "empty-v4";
const MEMBERS_GROUP_ID = "members-v4";
function directoryUser(userId: string): OrganizationDirectoryUserResponse {
  return {
    userId,
    signingKeyFingerprint: `signing-fingerprint-${userId}`,
    signingPublicKey: `signing-public-key-${userId}`,
    encapsulationPublicKey: `encapsulation-public-key-${userId}`,
    encapsulationKeyFingerprint: `encapsulation-fingerprint-${userId}`,
    createdAt: CREATED_AT,
    isSelf: userId === "user-1",
    status: "active",
    profileDocumentId: `profile-${userId}`,
    joinedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    disabledAt: null,
    disabledByUserId: null,
  };
}

function member(
  userId: string,
  role: OrganizationGroupMemberResponse["role"] = "member",
): OrganizationGroupMemberResponse {
  return {
    userId,
    role,
    signingKeyFingerprint: `signing-fingerprint-${userId}`,
    signingPublicKey: `signing-public-key-${userId}`,
    encapsulationPublicKey: `encapsulation-public-key-${userId}`,
    encapsulationKeyFingerprint: `encapsulation-fingerprint-${userId}`,
  };
}

function membership(
  groupId: string,
  stateHash: string,
  members: OrganizationGroupMemberResponse[],
): OrganizationReadModelGroupMembershipResponse {
  return { groupId, stateHash, members };
}

function membershipsLane(
  groups: OrganizationReadModelGroupMembershipResponse[],
  deletedGroupIds: string[] = [],
): OrganizationReadModelGroupMembershipsResponse {
  return { organizationId: ORGANIZATION_ID, groups, deletedGroupIds };
}

function defaultMemberships(): OrganizationReadModelGroupMembershipResponse[] {
  return [
    membership(ADMINS_GROUP_ID, "admins-state-1", [
      member("user-1", "admin"),
      member("user-2"),
    ]),
    membership(EMPTY_GROUP_ID, "empty-state-1", []),
    membership(MEMBERS_GROUP_ID, "members-state-1", [member("user-1")]),
  ];
}

function groupsLane(
  input: {
    adminMemberCount?: number;
    adminName?: string;
    adminStateHash?: string;
    includeAdmin?: boolean;
  } = {},
): ListOrganizationGroupsResponse {
  const groups: ListOrganizationGroupsResponse["groups"] = [
    ...(input.includeAdmin === false
      ? []
      : [
          {
            groupId: ADMINS_GROUP_ID,
            organizationId: ORGANIZATION_ID,
            name: input.adminName ?? "Admins",
            createdAt: CREATED_AT,
            isBuiltin: true,
            currentState: {
              stateHash: input.adminStateHash ?? "admins-state-1",
              version: 1,
              keyEpoch: 1,
              keyFingerprint: `admins-key-${input.adminStateHash ?? "admins-state-1"}`,
              memberCount: input.adminMemberCount ?? 2,
            },
          },
        ]),
    {
      groupId: EMPTY_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      name: "Empty",
      createdAt: CREATED_AT,
      isBuiltin: false,
      currentState: {
        stateHash: "empty-state-1",
        version: 1,
        keyEpoch: 1,
        keyFingerprint: "empty-key-1",
        memberCount: 0,
      },
    },
  ];
  return {
    organizationId: ORGANIZATION_ID,
    memberGroupId: MEMBERS_GROUP_ID,
    groups,
  };
}

function organizationPolicyLane(): OrganizationReadModelOrganizationPolicyResponse {
  return {
    organizationId: ORGANIZATION_ID,
    currentState: {
      stateHash: "organization-state-1",
      version: 1,
      keyEpoch: 1,
      keyFingerprint: "organization-key-1",
      memberCount: 2,
    },
  };
}

function snapshot(
  input: {
    cursor?: string;
    groupMemberships?: OrganizationReadModelGroupMembershipsResponse;
    groups?: ListOrganizationGroupsResponse;
  } = {},
): OrganizationReadModelSnapshotResponse {
  return {
    version: 4,
    mode: "snapshot",
    organizationId: ORGANIZATION_ID,
    nextCursor: input.cursor ?? "cursor-1",
    hasMore: false,
    currentUser: { isOrgAdmin: true },
    lanes: {
      directory: {
        organizationId: ORGANIZATION_ID,
        profileDocumentId: "organization-profile-1",
        users: [directoryUser("user-1"), directoryUser("user-2")],
      },
      grants: { organizationId: ORGANIZATION_ID, grants: [] },
      groups: input.groups ?? groupsLane(),
      groupMemberships:
        input.groupMemberships ?? membershipsLane(defaultMemberships()),
      organizationPolicy: organizationPolicyLane(),
    },
  };
}

function delta(input: {
  groupMemberships: OrganizationReadModelGroupMembershipsResponse;
  groups?: ListOrganizationGroupsResponse;
  nextCursor?: string;
  profileDocumentId?: string;
}): OrganizationReadModelDeltaResponse {
  return {
    version: 4,
    mode: "delta",
    organizationId: ORGANIZATION_ID,
    nextCursor: input.nextCursor ?? "cursor-2",
    hasMore: false,
    currentUser: { isOrgAdmin: false },
    lanes: {
      ...(input.profileDocumentId
        ? {
            directory: {
              organizationId: ORGANIZATION_ID,
              profileDocumentId: input.profileDocumentId,
              users: [directoryUser("user-1")],
            },
          }
        : {}),
      ...(input.groups ? { groups: input.groups } : {}),
      groupMemberships: input.groupMemberships,
    },
  };
}

async function applySnapshot(
  execSql: ExecSql,
  response = snapshot(),
): Promise<void> {
  await expect(
    applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response,
    }),
  ).resolves.toBe("applied");
}

function loadMembers(execSql: ExecSql, groupId: string) {
  return loadOrganizationReadModelGroupMembers(
    execSql,
    ORGANIZATION_ID,
    groupId,
    "user-1",
  );
}

test("v4 snapshots persist visible, hidden Members, and empty group memberships", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-snapshot-v4",
  );
  try {
    await applySnapshot(execSql);

    await expect(loadMembers(execSql, ADMINS_GROUP_ID)).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      groupId: ADMINS_GROUP_ID,
      members: [member("user-1", "admin"), member("user-2")],
    });
    await expect(loadMembers(execSql, MEMBERS_GROUP_ID)).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      groupId: MEMBERS_GROUP_ID,
      members: [member("user-1")],
    });
    await expect(loadMembers(execSql, EMPTY_GROUP_ID)).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      groupId: EMPTY_GROUP_ID,
      members: [],
    });

    const projection = await loadOrganizationReadModelProjection(
      execSql,
      ORGANIZATION_ID,
      "user-1",
    );
    expect(projection?.groups.groups.map((group) => group.groupId)).toEqual([
      ADMINS_GROUP_ID,
      EMPTY_GROUP_ID,
    ]);
  } finally {
    close();
  }
});

test("entity membership deltas replace only the supplied group", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-delta-v4",
  );
  try {
    await applySnapshot(execSql);
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: delta({
          groups: groupsLane({
            adminMemberCount: 1,
            adminStateHash: "admins-state-2",
          }),
          groupMemberships: membershipsLane([
            membership(ADMINS_GROUP_ID, "admins-state-2", [member("user-3")]),
          ]),
        }),
      }),
    ).resolves.toBe("applied");

    expect(await loadMembers(execSql, ADMINS_GROUP_ID)).toMatchObject({
      members: [expect.objectContaining({ userId: "user-3" })],
    });
    expect(await loadMembers(execSql, MEMBERS_GROUP_ID)).toMatchObject({
      members: [expect.objectContaining({ userId: "user-1" })],
    });
    expect(await loadMembers(execSql, EMPTY_GROUP_ID)).toMatchObject({
      members: [],
    });
  } finally {
    close();
  }
});

test("entity membership deletions remove only the target group", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-delete-v4",
  );
  try {
    await applySnapshot(execSql);
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: delta({
          groups: groupsLane({ includeAdmin: false }),
          groupMemberships: membershipsLane([], [ADMINS_GROUP_ID]),
        }),
      }),
    ).resolves.toBe("applied");

    await expect(loadMembers(execSql, ADMINS_GROUP_ID)).resolves.toBeNull();
    await expect(loadMembers(execSql, MEMBERS_GROUP_ID)).resolves.toMatchObject(
      { groupId: MEMBERS_GROUP_ID },
    );
    await expect(loadMembers(execSql, EMPTY_GROUP_ID)).resolves.toMatchObject({
      groupId: EMPTY_GROUP_ID,
      members: [],
    });
  } finally {
    close();
  }
});

test("invalid memberships roll back every changed lane and the cursor", async () => {
  const cases = ["duplicate-member", "state-hash", "member-count"] as const;
  for (const invalidCase of cases) {
    const { close, execSql } = await createTestExecSql(
      `org-memberships-${invalidCase}`,
    );
    try {
      await applySnapshot(execSql);
      const invalidMembership = membership(
        ADMINS_GROUP_ID,
        invalidCase === "state-hash" ? "wrong-state" : "admins-state-1",
        invalidCase === "member-count"
          ? [member("user-1", "admin")]
          : [member("user-1", "admin"), member("user-2")],
      );
      if (invalidCase === "duplicate-member") {
        invalidMembership.members.push(member("user-1"));
      }

      await expect(
        applyOrganizationReadModelResponse({
          currentUserId: "user-1",
          execSql,
          requestedCursor: "cursor-1",
          response: delta({
            groups: groupsLane({ adminName: "Must roll back" }),
            groupMemberships: membershipsLane([invalidMembership]),
            profileDocumentId: "must-roll-back",
          }),
        }),
      ).rejects.toThrow();

      const projection = await loadOrganizationReadModelProjection(
        execSql,
        ORGANIZATION_ID,
        "user-1",
      );
      expect(projection).toMatchObject({
        cursor: "cursor-1",
        directory: { profileDocumentId: "organization-profile-1" },
        requester: { isOrgAdmin: true },
      });
      expect(projection?.groups.groups[0]?.name).toBe("Admins");
      expect(await loadMembers(execSql, ADMINS_GROUP_ID)).toMatchObject({
        members: [expect.anything(), expect.anything()],
      });
    } finally {
      close();
    }
  }
});

test("large membership snapshots are persisted across insert batches", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-large-v4",
  );
  const groupId = "large-group-v4";
  const members = Array.from({ length: 95 }, (_, index) =>
    member(`member-${index}`),
  );
  const groupLane: ListOrganizationGroupsResponse = {
    organizationId: ORGANIZATION_ID,
    memberGroupId: MEMBERS_GROUP_ID,
    groups: [
      {
        groupId,
        organizationId: ORGANIZATION_ID,
        name: "Large group",
        createdAt: CREATED_AT,
        isBuiltin: false,
        currentState: {
          stateHash: "large-state-1",
          version: 1,
          keyEpoch: 1,
          keyFingerprint: "large-key-1",
          memberCount: members.length,
        },
      },
    ],
  };
  try {
    await applySnapshot(
      execSql,
      snapshot({
        groups: groupLane,
        groupMemberships: membershipsLane([
          membership(groupId, "large-state-1", members),
          membership(MEMBERS_GROUP_ID, "members-state-1", [member("user-1")]),
        ]),
      }),
    );

    const stored = await loadMembers(execSql, groupId);
    expect(stored?.members).toHaveLength(95);
    expect(stored?.members[0]?.userId).toBe("member-0");
    expect(stored?.members[94]?.userId).toBe("member-94");
  } finally {
    close();
  }
});

test("purge clears membership rows without deleting verified policy checkpoints", async () => {
  const { close, execSql } = await createTestExecSql(
    "org-memberships-purge-v4",
  );
  try {
    await applySnapshot(execSql);
    await loadPrincipalPolicyCheckpoint(execSql, "group", "verified-group");
    await execSql(
      `INSERT INTO principal_policy_checkpoints
        (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["group", "verified-group", 3, "verified-state", CREATED_AT],
    );

    await purgeOrganizationReadModelProjection(execSql, ORGANIZATION_ID);

    const headRows = await execSql(
      "SELECT COUNT(*) AS count FROM organization_read_model_group_memberships",
      undefined,
      { rowMode: "array" },
    );
    const memberRows = await execSql(
      "SELECT COUNT(*) AS count FROM organization_read_model_group_members",
      undefined,
      { rowMode: "array" },
    );
    expect(headRows[0]?.[0]).toBe(0);
    expect(memberRows[0]?.[0]).toBe(0);
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "verified-group"),
    ).resolves.toEqual({
      principalType: "group",
      principalId: "verified-group",
      version: 3,
      stateHash: "verified-state",
    });
  } finally {
    close();
  }
});
