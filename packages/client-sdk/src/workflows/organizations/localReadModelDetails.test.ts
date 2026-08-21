import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  OrganizationContainerGrantResponse,
  OrganizationGroupMemberResponse,
  OrganizationReadModelSnapshotResponse,
  PrincipalPolicyBundleResponse,
} from "@symcrypt/validators/response";
import { principalPolicy } from "../../../test/helpers/organizationReadModelFixtures";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import { applyOrganizationReadModelResponse } from "../../data/persistence/organizations/organizationReadModelPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  loadLocalOrganizationContainerGrants,
  loadLocalOrganizationGroupContainers,
  loadLocalOrganizationGroupPolicyHistory,
  loadLocalOrganizationUserDetail,
} from "./localReadModelDetails";

const CREATED_AT = "2026-07-17T12:00:00.000Z";
const ORGANIZATION_ID = "organization-local-details";
const CURRENT_USER_ID = "requester-user";
const TARGET_USER_ID = "target-user";
const MEMBERS_GROUP_ID = "members-group";
const CYCLE_GROUP_ID = "cycle-group";

function userMember(userId: string): OrganizationGroupMemberResponse {
  return {
    userId,
    role: "member",
    signingKeyFingerprint: `signing-fingerprint-${userId}`,
    signingPublicKey: `signing-key-${userId}`,
    encapsulationPublicKey: `encapsulation-key-${userId}`,
    encapsulationKeyFingerprint: `encapsulation-fingerprint-${userId}`,
  };
}

function grant(input: {
  readonly containerId: string;
  readonly subjectId: string;
  readonly subjectType: "group" | "user";
}): OrganizationContainerGrantResponse {
  const isGroup = input.subjectType === "group";
  const isUser = input.subjectType === "user";
  return {
    accessLevel: "read",
    containerId: input.containerId,
    createdAt: CREATED_AT,
    depth: 1,
    isBuiltin: false,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `manifest-${input.containerId}`,
    metadataDocumentId: `metadata-${input.containerId}`,
    parentId: "root-container",
    updatedAt: CREATED_AT,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    userId: isUser ? input.subjectId : null,
    signingKeyFingerprint: isUser
      ? `signing-fingerprint-${input.subjectId}`
      : null,
    groupId: isGroup ? input.subjectId : null,
    groupName: isGroup ? `Group ${input.subjectId}` : null,
  };
}

function snapshot(): OrganizationReadModelSnapshotResponse {
  const grants = [
    grant({
      containerId: "container-direct",
      subjectId: TARGET_USER_ID,
      subjectType: "user",
    }),
    grant({
      containerId: "container-hidden-group",
      subjectId: MEMBERS_GROUP_ID,
      subjectType: "group",
    }),
    grant({
      containerId: "container-unrelated-group",
      subjectId: "unrelated-group",
      subjectType: "group",
    }),
  ];
  return {
    version: 6,
    mode: "snapshot",
    organizationId: ORGANIZATION_ID,
    nextCursor: "cursor-local-details",
    hasMore: false,
    currentUser: { isOrgAdmin: true },
    lanes: {
      directory: {
        organizationId: ORGANIZATION_ID,
        profileDocumentId: "organization-profile",
        users: [CURRENT_USER_ID, TARGET_USER_ID].map((userId) => ({
          userId,
          signingKeyFingerprint: `signing-fingerprint-${userId}`,
          signingPublicKey: `signing-key-${userId}`,
          encapsulationPublicKey: `encapsulation-key-${userId}`,
          encapsulationKeyFingerprint: `encapsulation-fingerprint-${userId}`,
          createdAt: CREATED_AT,
          isSelf: userId === CURRENT_USER_ID,
          status: "active" as const,
          profileDocumentId: `profile-${userId}`,
          joinedAt: CREATED_AT,
          updatedAt: CREATED_AT,
          disabledAt: null,
          disabledByUserId: null,
        })),
      },
      grants: { organizationId: ORGANIZATION_ID, grants },
      groups: {
        organizationId: ORGANIZATION_ID,
        memberGroupId: MEMBERS_GROUP_ID,
        groups: [
          {
            groupId: CYCLE_GROUP_ID,
            organizationId: ORGANIZATION_ID,
            name: "Cycle",
            createdAt: CREATED_AT,
            isBuiltin: false,
            currentState: {
              stateHash: "cycle-state",
              version: 1,
              keyEpoch: 1,
              keyFingerprint: "cycle-key-fingerprint",
              memberCount: 1,
            },
          },
        ],
      },
      groupMemberships: {
        organizationId: ORGANIZATION_ID,
        deletedGroupIds: [],
        groups: [
          {
            groupId: MEMBERS_GROUP_ID,
            stateHash: "members-state",
            members: [userMember(TARGET_USER_ID)],
          },
          {
            groupId: CYCLE_GROUP_ID,
            stateHash: "cycle-state",
            members: [userMember(TARGET_USER_ID)],
          },
        ],
      },
      organizationPolicy: {
        organizationId: ORGANIZATION_ID,
        currentState: {
          stateHash: "organization-policy-state",
          version: 1,
          keyEpoch: 1,
          keyFingerprint: "organization-policy-key-fingerprint",
          memberCount: 1,
        },
      },
    },
  };
}

function policyBundleForGroup(groupId: string): PrincipalPolicyBundleResponse {
  return {
    ...principalPolicy,
    currentState: {
      ...principalPolicy.currentState,
      principalId: groupId,
    },
    currentPayload: {
      ...principalPolicy.currentPayload,
      principalId: groupId,
    },
    currentMemberEnvelopes: {
      ...principalPolicy.currentMemberEnvelopes,
      principalId: groupId,
    },
    previousStates: principalPolicy.previousStates.map((entry) => ({
      ...entry,
      state: {
        ...entry.state,
        principalId: groupId,
      },
    })),
  };
}

function policySnapshot(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly projectedStateHash?: string | undefined;
}): OrganizationReadModelSnapshotResponse {
  const base = snapshot();
  const projectedState = {
    stateHash: input.projectedStateHash ?? input.bundle.currentState.stateHash,
    version: input.bundle.currentState.version,
    keyEpoch: input.bundle.currentState.keyEpoch,
    keyFingerprint: input.bundle.currentState.keyFingerprint,
    memberCount: input.bundle.currentState.memberCount,
  };
  return {
    ...base,
    lanes: {
      ...base.lanes,
      groups: {
        ...base.lanes.groups,
        groups: base.lanes.groups.groups.map((group) =>
          group.groupId === CYCLE_GROUP_ID
            ? { ...group, currentState: projectedState }
            : group,
        ),
      },
      groupMemberships: {
        ...base.lanes.groupMemberships,
        groups: base.lanes.groupMemberships.groups.map((group) =>
          group.groupId === CYCLE_GROUP_ID
            ? {
                ...group,
                stateHash: projectedState.stateHash,
                members: [userMember(TARGET_USER_ID)],
              }
            : group,
        ),
      },
    },
  };
}

test("local organization detail derives a user's groups and effective grants", async () => {
  // This replaces a test that also exercised group-in-group reachability and
  // membership cycles. Groups hold only users now, so the walk is gone — but
  // the derivation it wrapped is not, and this keeps it covered: which groups a
  // user belongs to, which grants reach them by group or directly, and that a
  // requester outside the projection sees nothing.
  const { close, execSql } = await createTestExecSql(
    "organization-local-read-model-details",
  );
  try {
    await ensureContainerTables(execSql);
    await saveContainer(execSql, {
      id: "container-hidden-group",
      organizationId: ORGANIZATION_ID,
      parentId: null,
      metadataDocumentId: null,
      name: "Members Group Container",
      icon: null,
    });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: CURRENT_USER_ID,
        execSql,
        requestedCursor: null,
        response: snapshot(),
      }),
    ).resolves.toBe("applied");

    const common = {
      currentUserId: CURRENT_USER_ID,
      execSql,
      organizationId: ORGANIZATION_ID,
    };
    const detail = await loadLocalOrganizationUserDetail({
      ...common,
      userId: TARGET_USER_ID,
    });
    expect(detail?.user.userId).toBe(TARGET_USER_ID);
    expect(detail?.user.isSelf).toBe(false);
    // Both groups list the user directly; neither reaches them via the other.
    // Only catalogued groups appear here — Members is the reserved group and is
    // carried separately as `memberGroupId`.
    expect(detail?.groups.map((group) => group.groupId)).toEqual([
      CYCLE_GROUP_ID,
    ]);
    expect(detail?.grants.groupGrants.map((item) => item.subjectId)).toEqual([
      MEMBERS_GROUP_ID,
    ]);
    expect(detail?.grants.groupGrants[0]?.containerDisplayName).toBe(
      "Members Group Container",
    );
    expect(detail?.grants.directGrants.map((item) => item.subjectId)).toEqual([
      TARGET_USER_ID,
    ]);
    const groupContainers = await loadLocalOrganizationGroupContainers({
      ...common,
      groupId: MEMBERS_GROUP_ID,
    });
    expect(groupContainers).toMatchObject({
      groupId: MEMBERS_GROUP_ID,
      containers: [
        {
          containerId: "container-hidden-group",
          containerDisplayName: "Members Group Container",
        },
      ],
    });
    await expect(
      loadLocalOrganizationGroupContainers({
        ...common,
        groupId: "unrelated-group",
      }),
    ).resolves.toBeNull();
    const allGrants = await loadLocalOrganizationContainerGrants(common);
    expect(allGrants?.grants).toHaveLength(3);

    // A requester with no projection row reads nothing at all.
    const otherRequester = {
      ...common,
      currentUserId: "requester-without-projection-access",
    };
    await expect(
      loadLocalOrganizationContainerGrants(otherRequester),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationGroupContainers({
        ...otherRequester,
        groupId: MEMBERS_GROUP_ID,
      }),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationUserDetail({
        ...otherRequester,
        userId: TARGET_USER_ID,
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("local group policy history requires an exact projected policy head", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-local-group-policy-history",
  );
  try {
    const bundle = policyBundleForGroup(CYCLE_GROUP_ID);
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: CURRENT_USER_ID,
        execSql,
        requestedCursor: null,
        response: policySnapshot({ bundle }),
      }),
    ).resolves.toBe("applied");
    await savePrincipalPolicyBundle(execSql, bundle, CREATED_AT);

    const common = {
      currentUserId: CURRENT_USER_ID,
      execSql,
      groupId: CYCLE_GROUP_ID,
      organizationId: ORGANIZATION_ID,
    };
    const history = await loadLocalOrganizationGroupPolicyHistory(common);
    expect(history?.groupId).toBe(CYCLE_GROUP_ID);
    expect(history?.entries.map((entry) => entry.version)).toEqual([3, 2, 1]);
    await expect(
      loadLocalOrganizationGroupPolicyHistory({
        ...common,
        currentUserId: "requester-without-projection-access",
      }),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationGroupPolicyHistory({
        ...common,
        groupId: "group-outside-visible-projection",
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("local group policy history rejects a stale stored policy bundle", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-local-group-policy-history-stale",
  );
  try {
    const bundle = policyBundleForGroup(CYCLE_GROUP_ID);
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: CURRENT_USER_ID,
        execSql,
        requestedCursor: null,
        response: policySnapshot({
          bundle,
          projectedStateHash: "newer-projected-state",
        }),
      }),
    ).resolves.toBe("applied");
    await savePrincipalPolicyBundle(execSql, bundle, CREATED_AT);

    await expect(
      loadLocalOrganizationGroupPolicyHistory({
        currentUserId: CURRENT_USER_ID,
        execSql,
        groupId: CYCLE_GROUP_ID,
        organizationId: ORGANIZATION_ID,
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
