import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryUserResponse,
  OrganizationReadModelDeltaResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelGroupMembershipsResponse,
  OrganizationReadModelOrganizationPolicyResponse,
  OrganizationReadModelSnapshotResponse,
} from "@symcrypt/validators/response";

const CREATED_AT = "2026-07-16T12:00:00.000Z";

export function organizationReadModelDirectoryUser(
  userId: string,
  overrides: Partial<OrganizationDirectoryUserResponse> = {},
): OrganizationDirectoryUserResponse {
  return {
    userId,
    signingKeyFingerprint: `signing-fingerprint-${userId}`,
    signingPublicKey: `signing-public-key-${userId}`,
    encapsulationPublicKey: `encapsulation-public-key-${userId}`,
    encapsulationKeyFingerprint: `encapsulation-fingerprint-${userId}`,
    createdAt: CREATED_AT,
    isSelf: false,
    status: "active",
    profileDocumentId: `profile-${userId}`,
    joinedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    disabledAt: null,
    disabledByUserId: null,
    ...overrides,
  };
}

export function organizationReadModelDirectory(
  organizationId: string,
  overrides: Partial<OrganizationReadModelDirectoryResponse> = {},
): OrganizationReadModelDirectoryResponse {
  return {
    organizationId,
    profileDocumentId: `organization-profile-${organizationId}`,
    users: [
      organizationReadModelDirectoryUser("user-1", { isSelf: true }),
      organizationReadModelDirectoryUser("user-2", { isSelf: false }),
    ],
    ...overrides,
  };
}

export function organizationReadModelGroups(
  organizationId: string,
  suffix = "initial",
): ListOrganizationGroupsResponse {
  return {
    organizationId,
    memberGroupId: `members-${organizationId}`,
    groups: [
      {
        groupId: `admins-${organizationId}`,
        organizationId,
        name: `Admins ${suffix}`,
        createdAt: CREATED_AT,
        isBuiltin: true,
        currentState: {
          stateHash: `state-${suffix}`,
          version: 2,
          keyEpoch: 2,
          keyFingerprint: `key-fingerprint-${suffix}`,
          memberCount: 1,
        },
      },
      {
        groupId: `empty-${organizationId}`,
        organizationId,
        name: `Empty ${suffix}`,
        createdAt: CREATED_AT,
        isBuiltin: false,
        currentState: null,
      },
    ],
  };
}

export function organizationReadModelOrganizationPolicy(
  organizationId: string,
  suffix = "initial",
): OrganizationReadModelOrganizationPolicyResponse {
  return {
    organizationId,
    currentState: {
      stateHash: `organization-state-${suffix}`,
      version: 2,
      keyEpoch: 2,
      keyFingerprint: `organization-key-fingerprint-${suffix}`,
      memberCount: 1,
    },
  };
}

function organizationReadModelMemberships(
  groups: ListOrganizationGroupsResponse,
  includeMemberGroup = true,
): OrganizationReadModelGroupMembershipsResponse {
  return {
    organizationId: groups.organizationId,
    deletedGroupIds: [],
    groups: [
      ...(includeMemberGroup
        ? [
            {
              groupId: groups.memberGroupId,
              stateHash: `members-state-${groups.organizationId}`,
              members: [],
            },
          ]
        : []),
      ...groups.groups.flatMap((group) =>
        group.currentState
          ? [
              {
                groupId: group.groupId,
                stateHash: group.currentState.stateHash,
                members: [
                  {
                    userId: "user-1",
                    role: "admin" as const,
                    signingKeyFingerprint: "signing-fingerprint-user-1",
                    signingPublicKey: "signing-public-key-user-1",
                    encapsulationPublicKey: "encapsulation-public-key-user-1",
                    encapsulationKeyFingerprint:
                      "encapsulation-fingerprint-user-1",
                    groupId: null,
                    groupName: null,
                  },
                ],
              },
            ]
          : [],
      ),
    ],
  };
}

function organizationReadModelGrants(
  organizationId: string,
): OrganizationContainerGrantsResponse {
  return { organizationId, grants: [] };
}

export function organizationReadModelSnapshot(
  organizationId: string,
  nextCursor: string,
  suffix = "initial",
  isOrgAdmin = true,
): OrganizationReadModelSnapshotResponse {
  const groups = organizationReadModelGroups(organizationId, suffix);
  return {
    version: 6,
    mode: "snapshot",
    organizationId,
    nextCursor,
    hasMore: false,
    currentUser: { isOrgAdmin },
    lanes: {
      directory: organizationReadModelDirectory(organizationId),
      grants: organizationReadModelGrants(organizationId),
      groupMemberships: organizationReadModelMemberships(groups),
      groups,
      organizationPolicy: organizationReadModelOrganizationPolicy(
        organizationId,
        suffix,
      ),
    },
  };
}

export function organizationReadModelDelta(input: {
  directory?: OrganizationReadModelDirectoryResponse;
  groupMemberships?: OrganizationReadModelGroupMembershipsResponse;
  groups?: ListOrganizationGroupsResponse;
  isOrgAdmin?: boolean;
  nextCursor: string;
  organizationPolicy?: OrganizationReadModelOrganizationPolicyResponse;
  organizationId: string;
}): OrganizationReadModelDeltaResponse {
  const groupMemberships =
    input.groupMemberships ??
    (input.groups
      ? organizationReadModelMemberships(input.groups, false)
      : undefined);
  return {
    version: 6,
    mode: "delta",
    organizationId: input.organizationId,
    nextCursor: input.nextCursor,
    hasMore: false,
    currentUser: { isOrgAdmin: input.isOrgAdmin ?? true },
    lanes: {
      ...(input.directory ? { directory: input.directory } : {}),
      ...(groupMemberships ? { groupMemberships } : {}),
      ...(input.groups ? { groups: input.groups } : {}),
      ...(input.organizationPolicy
        ? { organizationPolicy: input.organizationPolicy }
        : {}),
    },
  };
}
