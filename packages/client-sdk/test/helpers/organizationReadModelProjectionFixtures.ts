import type { RequestFailure } from "@tearleads/api-client";
import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryUserResponse,
  OrganizationReadModelDeltaResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelGroupMembershipsResponse,
  OrganizationReadModelOrganizationPolicyResponse,
  OrganizationReadModelSnapshotResponse,
} from "@tearleads/validators/response";

export const organizationReadModelOrganizationId = "org-1";
export const organizationReadModelUserId = "user-1";

const CREATED_AT = "2026-07-16T12:00:00.000Z";

function directoryUser(
  userId: string,
  currentUserId: string,
): OrganizationDirectoryUserResponse {
  return {
    userId,
    signingKeyFingerprint: `signing-fingerprint-${userId}`,
    signingPublicKey: `signing-public-key-${userId}`,
    encapsulationPublicKey: `encapsulation-public-key-${userId}`,
    encapsulationKeyFingerprint: `encapsulation-fingerprint-${userId}`,
    createdAt: CREATED_AT,
    isSelf: userId === currentUserId,
    status: "active",
    profileDocumentId: `profile-${userId}`,
    joinedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    disabledAt: null,
    disabledByUserId: null,
  };
}

function organizationReadModelDirectory(
  input: {
    readonly currentUserId?: string;
    readonly organizationId?: string;
    readonly userIds?: readonly string[];
  } = {},
): OrganizationReadModelDirectoryResponse {
  const organizationId =
    input.organizationId ?? organizationReadModelOrganizationId;
  const currentUserId = input.currentUserId ?? organizationReadModelUserId;
  return {
    organizationId,
    profileDocumentId: `profile-${organizationId}`,
    users: (input.userIds ?? [currentUserId, "user-2"]).map((userId) =>
      directoryUser(userId, currentUserId),
    ),
  };
}

function organizationReadModelGroups(
  input: {
    readonly groupName?: string | undefined;
    readonly organizationId?: string | undefined;
  } = {},
): ListOrganizationGroupsResponse {
  const organizationId =
    input.organizationId ?? organizationReadModelOrganizationId;
  const groupName = input.groupName ?? "Admins";
  return {
    organizationId,
    memberGroupId: `members-${organizationId}`,
    groups: [
      {
        groupId: `group-${organizationId}`,
        organizationId,
        name: groupName,
        createdAt: CREATED_AT,
        isBuiltin: groupName === "Admins",
        currentState: {
          stateHash: `state-${groupName}`,
          version: 1,
          keyEpoch: 1,
          keyFingerprint: `key-${groupName}`,
          memberCount: 1,
        },
      },
    ],
  };
}

function organizationReadModelOrganizationPolicy(
  organizationId: string,
  suffix: string,
): OrganizationReadModelOrganizationPolicyResponse {
  return {
    organizationId,
    currentState: {
      stateHash: `organization-state-${suffix}`,
      version: 1,
      keyEpoch: 1,
      keyFingerprint: `organization-key-${suffix}`,
      memberCount: 1,
    },
  };
}

function organizationReadModelMemberships(
  groups: ListOrganizationGroupsResponse,
  includeMemberGroup: boolean,
): OrganizationReadModelGroupMembershipsResponse {
  const visibleGroup = groups.groups[0];
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
      ...(visibleGroup?.currentState
        ? [
            {
              groupId: visibleGroup.groupId,
              stateHash: visibleGroup.currentState.stateHash,
              members: [
                {
                  userId: organizationReadModelUserId,
                  role: "admin" as const,
                  signingKeyFingerprint: `signing-fingerprint-${organizationReadModelUserId}`,
                  signingPublicKey: `signing-public-key-${organizationReadModelUserId}`,
                  encapsulationPublicKey: `encapsulation-public-key-${organizationReadModelUserId}`,
                  encapsulationKeyFingerprint: `encapsulation-fingerprint-${organizationReadModelUserId}`,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

function organizationReadModelGrants(
  groups: ListOrganizationGroupsResponse,
): OrganizationContainerGrantsResponse {
  const group = groups.groups[0];
  return {
    organizationId: groups.organizationId,
    grants: group
      ? [
          {
            accessLevel: "admin",
            containerId: `container-${groups.organizationId}`,
            createdAt: CREATED_AT,
            depth: 0,
            isBuiltin: true,
            metadataAccessEpoch: 1,
            metadataAccessStateHash: `manifest-${groups.organizationId}`,
            metadataDocumentId: `metadata-${groups.organizationId}`,
            parentId: null,
            updatedAt: CREATED_AT,
            subjectType: "group",
            subjectId: group.groupId,
            userId: null,
            signingKeyFingerprint: null,
            groupId: group.groupId,
            groupName: group.name,
          },
        ]
      : [],
  };
}

export function organizationReadModelSnapshot(
  input: {
    readonly cursor?: string;
    readonly currentUserId?: string;
    readonly groupName?: string;
    readonly isOrgAdmin?: boolean;
    readonly organizationId?: string;
  } = {},
): OrganizationReadModelSnapshotResponse {
  const organizationId =
    input.organizationId ?? organizationReadModelOrganizationId;
  const groups = organizationReadModelGroups({
    groupName: input.groupName,
    organizationId,
  });
  return {
    version: 6,
    mode: "snapshot",
    organizationId,
    nextCursor: input.cursor ?? "cursor-1",
    hasMore: false,
    currentUser: { isOrgAdmin: input.isOrgAdmin ?? true },
    lanes: {
      directory: organizationReadModelDirectory({
        currentUserId: input.currentUserId ?? organizationReadModelUserId,
        organizationId,
      }),
      grants: organizationReadModelGrants(groups),
      groupMemberships: organizationReadModelMemberships(groups, true),
      groups,
      organizationPolicy: organizationReadModelOrganizationPolicy(
        organizationId,
        input.groupName ?? "Admins",
      ),
    },
  };
}

export function organizationReadModelGroupsDelta(input: {
  readonly cursor: string;
  readonly groupName: string;
  readonly isOrgAdmin?: boolean;
  readonly organizationId?: string;
}): OrganizationReadModelDeltaResponse {
  const organizationId =
    input.organizationId ?? organizationReadModelOrganizationId;
  const groups = organizationReadModelGroups({
    groupName: input.groupName,
    organizationId,
  });
  return {
    version: 6,
    mode: "delta",
    organizationId,
    nextCursor: input.cursor,
    hasMore: false,
    currentUser: { isOrgAdmin: input.isOrgAdmin ?? true },
    lanes: {
      groupMemberships: organizationReadModelMemberships(groups, false),
      groups,
    },
  };
}

export function organizationReadModelFailure(input: {
  readonly code?: string | undefined;
  readonly kind: RequestFailure["kind"];
  readonly report?: () => void;
  readonly status: number | null;
}): RequestFailure {
  return {
    ...(input.code === undefined ? {} : { code: input.code }),
    kind: input.kind,
    message: `read-model ${input.kind} failure`,
    method: "GET",
    ok: false,
    path: `/organizations/${organizationReadModelOrganizationId}/read-model`,
    report: input.report ?? (() => {}),
    status: input.status,
    statusText: input.status === null ? "" : "failed",
  };
}
