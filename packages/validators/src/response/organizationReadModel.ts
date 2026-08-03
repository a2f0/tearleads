import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasBooleanProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
} from "../util";
import {
  isListOrganizationGroupsResponse,
  isOrganizationContainerGrantResponse,
  isOrganizationDirectoryUserResponse,
  isOrganizationGroupCurrentStateResponse,
  isOrganizationGroupMemberResponse,
  type ListOrganizationGroupsResponse,
  type OrganizationContainerGrantsResponse,
  type OrganizationDirectoryResponse,
  type OrganizationGroupCurrentStateResponse,
  type OrganizationGroupMemberResponse,
} from "./organization";

export type OrganizationReadModelDirectoryResponse = Omit<
  OrganizationDirectoryResponse,
  "currentUser"
>;

export type OrganizationReadModelGrantsResponse =
  OrganizationContainerGrantsResponse;

export interface OrganizationReadModelGroupMembershipResponse {
  readonly groupId: string;
  readonly stateHash: string;
  readonly members: OrganizationGroupMemberResponse[];
}

export interface OrganizationReadModelGroupMembershipsResponse {
  readonly deletedGroupIds: string[];
  readonly organizationId: string;
  readonly groups: OrganizationReadModelGroupMembershipResponse[];
}

export interface OrganizationReadModelOrganizationPolicyResponse {
  readonly currentState: OrganizationGroupCurrentStateResponse;
  readonly organizationId: string;
}

interface OrganizationReadModelResponseBase {
  readonly currentUser: OrganizationDirectoryResponse["currentUser"];
  readonly hasMore: boolean;
  readonly nextCursor: string;
  readonly organizationId: string;
  readonly version: 5;
}

export interface OrganizationReadModelSnapshotResponse
  extends OrganizationReadModelResponseBase {
  readonly mode: "snapshot";
  readonly lanes: {
    readonly directory: OrganizationReadModelDirectoryResponse;
    readonly grants: OrganizationReadModelGrantsResponse;
    readonly groupMemberships: OrganizationReadModelGroupMembershipsResponse;
    readonly groups: ListOrganizationGroupsResponse;
    readonly organizationPolicy: OrganizationReadModelOrganizationPolicyResponse;
  };
}

export interface OrganizationReadModelDeltaResponse
  extends OrganizationReadModelResponseBase {
  readonly mode: "delta";
  readonly lanes: {
    readonly directory?: OrganizationReadModelDirectoryResponse;
    readonly grants?: OrganizationReadModelGrantsResponse;
    readonly groupMemberships?: OrganizationReadModelGroupMembershipsResponse;
    readonly groups?: ListOrganizationGroupsResponse;
    readonly organizationPolicy?: OrganizationReadModelOrganizationPolicyResponse;
  };
}

export type OrganizationReadModelResponse =
  | OrganizationReadModelDeltaResponse
  | OrganizationReadModelSnapshotResponse;

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): boolean {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === expectedKeys.length &&
    Object.keys(value).every((key) => expectedKeys.includes(key))
  );
}

function isDirectoryLane(
  value: unknown,
): value is OrganizationReadModelDirectoryResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasNullableStringProperty(value, "profileDocumentId") &&
    hasArrayProperty(value, "users") &&
    value.users.every(isOrganizationDirectoryUserResponse) &&
    hasExactKeys(value, ["organizationId", "profileDocumentId", "users"]) &&
    value.users.every((user) =>
      hasExactKeys(user, [
        "userId",
        "signingKeyFingerprint",
        "signingPublicKey",
        "encapsulationPublicKey",
        "encapsulationKeyFingerprint",
        "createdAt",
        "isSelf",
        "status",
        "profileDocumentId",
        "joinedAt",
        "updatedAt",
        "disabledAt",
        "disabledByUserId",
      ]),
    )
  );
}

function isGroupsLane(value: unknown): value is ListOrganizationGroupsResponse {
  return (
    isListOrganizationGroupsResponse(value) &&
    hasExactKeys(value, ["organizationId", "memberGroupId", "groups"]) &&
    value.groups.every(
      (group) =>
        hasExactKeys(group, [
          "groupId",
          "organizationId",
          "name",
          "createdAt",
          "isBuiltin",
          "currentState",
        ]) &&
        (group.currentState === null ||
          hasExactKeys(group.currentState, [
            "stateHash",
            "version",
            "keyEpoch",
            "keyFingerprint",
            "memberCount",
          ])),
    )
  );
}

function isOrganizationPolicyLane(
  value: unknown,
): value is OrganizationReadModelOrganizationPolicyResponse {
  if (
    !isPlainObject(value) ||
    !hasStringProperty(value, "organizationId") ||
    !hasObjectProperty(value, "currentState") ||
    !hasExactKeys(value, ["organizationId", "currentState"])
  ) {
    return false;
  }

  const currentState = value.currentState;
  return (
    isOrganizationGroupCurrentStateResponse(currentState) &&
    currentState.stateHash.length > 0 &&
    hasExactKeys(currentState, [
      "stateHash",
      "version",
      "keyEpoch",
      "keyFingerprint",
      "memberCount",
    ])
  );
}

function hasValidGrantSubjectFields(
  grant: OrganizationContainerGrantsResponse["grants"][number],
): boolean {
  if (grant.subjectType === "user") {
    return (
      grant.userId === grant.subjectId &&
      grant.groupId === null &&
      grant.groupName === null &&
      grant.organizationName === null
    );
  }
  if (grant.subjectType === "group") {
    return (
      grant.userId === null &&
      grant.signingKeyFingerprint === null &&
      grant.groupId === grant.subjectId &&
      grant.organizationName === null
    );
  }
  return (
    grant.userId === null &&
    grant.signingKeyFingerprint === null &&
    grant.groupId === null &&
    grant.groupName === null
  );
}

function isGrantsLane(
  value: unknown,
): value is OrganizationReadModelGrantsResponse {
  if (
    !isPlainObject(value) ||
    !hasStringProperty(value, "organizationId") ||
    !hasArrayProperty(value, "grants") ||
    !hasExactKeys(value, ["organizationId", "grants"])
  ) {
    return false;
  }

  const grantKeys = new Set<string>();
  for (const grant of value.grants) {
    if (
      !isOrganizationContainerGrantResponse(grant) ||
      !hasExactKeys(grant, [
        "accessLevel",
        "containerId",
        "createdAt",
        "depth",
        "isBuiltin",
        "metadataAccessEpoch",
        "metadataAccessStateHash",
        "metadataDocumentId",
        "parentId",
        "updatedAt",
        "subjectType",
        "subjectId",
        "userId",
        "signingKeyFingerprint",
        "groupId",
        "groupName",
        "organizationName",
      ]) ||
      !hasValidGrantSubjectFields(grant)
    ) {
      return false;
    }
    const key = `${grant.subjectType}:${grant.subjectId}:${grant.containerId}`;
    if (grantKeys.has(key)) {
      return false;
    }
    grantKeys.add(key);
  }
  return true;
}

function isGroupMembership(
  value: unknown,
): value is OrganizationReadModelGroupMembershipResponse {
  if (
    !isPlainObject(value) ||
    !hasStringProperty(value, "groupId") ||
    !hasStringProperty(value, "stateHash") ||
    value.stateHash.length === 0 ||
    !hasArrayProperty(value, "members") ||
    !hasExactKeys(value, ["groupId", "stateHash", "members"])
  ) {
    return false;
  }

  const memberKeys = new Set<string>();
  for (const member of value.members) {
    if (
      !isOrganizationGroupMemberResponse(member) ||
      !hasExactKeys(member, [
        "role",
        "userId",
        "signingKeyFingerprint",
        "signingPublicKey",
        "encapsulationPublicKey",
        "encapsulationKeyFingerprint",
      ])
    ) {
      return false;
    }
    const key = member.userId;
    if (memberKeys.has(key)) {
      return false;
    }
    memberKeys.add(key);
  }
  return true;
}

function isGroupMembershipsLane(
  value: unknown,
): value is OrganizationReadModelGroupMembershipsResponse {
  if (
    !isPlainObject(value) ||
    !hasStringProperty(value, "organizationId") ||
    !hasArrayProperty(value, "deletedGroupIds") ||
    !hasArrayProperty(value, "groups") ||
    !hasExactKeys(value, ["organizationId", "groups", "deletedGroupIds"])
  ) {
    return false;
  }

  const groupIds = new Set<string>();
  for (const group of value.groups) {
    if (!isGroupMembership(group) || groupIds.has(group.groupId)) {
      return false;
    }
    groupIds.add(group.groupId);
  }
  const deletedGroupIds = new Set<string>();
  for (const groupId of value.deletedGroupIds) {
    if (
      typeof groupId !== "string" ||
      groupId.length === 0 ||
      groupIds.has(groupId) ||
      deletedGroupIds.has(groupId)
    ) {
      return false;
    }
    deletedGroupIds.add(groupId);
  }
  return true;
}

function hasValidCommonFields(value: unknown): value is {
  readonly currentUser: OrganizationDirectoryResponse["currentUser"];
  readonly hasMore: boolean;
  readonly lanes: Record<string, unknown>;
  readonly mode: string;
  readonly nextCursor: string;
  readonly organizationId: string;
  readonly version: number;
} {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      "version",
      "mode",
      "organizationId",
      "nextCursor",
      "hasMore",
      "currentUser",
      "lanes",
    ]) &&
    hasNumberProperty(value, "version") &&
    value.version === 5 &&
    hasStringProperty(value, "mode") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "nextCursor") &&
    value.nextCursor.length > 0 &&
    hasBooleanProperty(value, "hasMore") &&
    hasObjectProperty(value, "currentUser") &&
    hasBooleanProperty(value.currentUser, "isOrgAdmin") &&
    hasExactKeys(value.currentUser, ["isOrgAdmin"]) &&
    hasObjectProperty(value, "lanes")
  );
}

export function isOrganizationReadModelResponse(
  value: unknown,
): value is OrganizationReadModelResponse {
  if (!hasValidCommonFields(value)) {
    return false;
  }

  if (
    Object.keys(value.lanes).some(
      (key) =>
        key !== "directory" &&
        key !== "grants" &&
        key !== "groupMemberships" &&
        key !== "groups" &&
        key !== "organizationPolicy",
    )
  ) {
    return false;
  }
  const directory = Reflect.get(value.lanes, "directory");
  const grants = Reflect.get(value.lanes, "grants");
  const groupMemberships = Reflect.get(value.lanes, "groupMemberships");
  const groups = Reflect.get(value.lanes, "groups");
  const organizationPolicy = Reflect.get(value.lanes, "organizationPolicy");
  const validDirectory = directory === undefined || isDirectoryLane(directory);
  const validGrants = grants === undefined || isGrantsLane(grants);
  const validGroupMemberships =
    groupMemberships === undefined || isGroupMembershipsLane(groupMemberships);
  const validGroups =
    groups === undefined ||
    (isGroupsLane(groups) &&
      groups.groups.every(
        (group) => group.organizationId === value.organizationId,
      ));
  const validOrganizationPolicy =
    organizationPolicy === undefined ||
    isOrganizationPolicyLane(organizationPolicy);
  if (
    !validDirectory ||
    !validGrants ||
    !validGroupMemberships ||
    !validGroups ||
    !validOrganizationPolicy
  ) {
    return false;
  }
  if (
    (directory && directory.organizationId !== value.organizationId) ||
    (grants && grants.organizationId !== value.organizationId) ||
    (groupMemberships &&
      groupMemberships.organizationId !== value.organizationId) ||
    (groups && groups.organizationId !== value.organizationId) ||
    (organizationPolicy &&
      organizationPolicy.organizationId !== value.organizationId)
  ) {
    return false;
  }

  if (value.mode === "snapshot") {
    return (
      directory !== undefined &&
      grants !== undefined &&
      groupMemberships !== undefined &&
      groupMemberships.deletedGroupIds.length === 0 &&
      groups !== undefined &&
      organizationPolicy !== undefined &&
      !value.hasMore
    );
  }

  return value.mode === "delta";
}
