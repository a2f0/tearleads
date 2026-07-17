import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryUserResponse,
  OrganizationReadModelDeltaResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelSnapshotResponse,
} from "@tearleads/validators/response";

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
        groupId: `admins-${suffix}`,
        organizationId,
        name: `Admins ${suffix}`,
        createdAt: CREATED_AT,
        isBuiltin: true,
        currentState: {
          stateHash: `state-${suffix}`,
          version: 2,
          keyEpoch: 2,
          memberCount: 1,
        },
      },
      {
        groupId: `empty-${suffix}`,
        organizationId,
        name: `Empty ${suffix}`,
        createdAt: CREATED_AT,
        isBuiltin: false,
        currentState: null,
      },
    ],
  };
}

export function organizationReadModelSnapshot(
  organizationId: string,
  nextCursor: string,
  suffix = "initial",
  isOrgAdmin = true,
): OrganizationReadModelSnapshotResponse {
  return {
    version: 1,
    mode: "snapshot",
    organizationId,
    nextCursor,
    hasMore: false,
    currentUser: { isOrgAdmin },
    lanes: {
      directory: organizationReadModelDirectory(organizationId),
      groups: organizationReadModelGroups(organizationId, suffix),
    },
  };
}

export function organizationReadModelDelta(input: {
  directory?: OrganizationReadModelDirectoryResponse;
  groups?: ListOrganizationGroupsResponse;
  isOrgAdmin?: boolean;
  nextCursor: string;
  organizationId: string;
}): OrganizationReadModelDeltaResponse {
  return {
    version: 1,
    mode: "delta",
    organizationId: input.organizationId,
    nextCursor: input.nextCursor,
    hasMore: false,
    currentUser: { isOrgAdmin: input.isOrgAdmin ?? true },
    lanes: {
      ...(input.directory ? { directory: input.directory } : {}),
      ...(input.groups ? { groups: input.groups } : {}),
    },
  };
}
