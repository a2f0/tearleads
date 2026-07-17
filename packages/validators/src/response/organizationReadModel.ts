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
  isOrganizationDirectoryUserResponse,
  type ListOrganizationGroupsResponse,
  type OrganizationDirectoryResponse,
} from "./organization";

export type OrganizationReadModelDirectoryResponse = Omit<
  OrganizationDirectoryResponse,
  "currentUser"
>;

interface OrganizationReadModelResponseBase {
  readonly currentUser: OrganizationDirectoryResponse["currentUser"];
  readonly hasMore: boolean;
  readonly nextCursor: string;
  readonly organizationId: string;
  readonly version: 1;
}

export interface OrganizationReadModelSnapshotResponse
  extends OrganizationReadModelResponseBase {
  readonly mode: "snapshot";
  readonly lanes: {
    readonly directory: OrganizationReadModelDirectoryResponse;
    readonly groups: ListOrganizationGroupsResponse;
  };
}

export interface OrganizationReadModelDeltaResponse
  extends OrganizationReadModelResponseBase {
  readonly mode: "delta";
  readonly lanes: {
    readonly directory?: OrganizationReadModelDirectoryResponse;
    readonly groups?: ListOrganizationGroupsResponse;
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

function isVersionOneDirectoryLane(
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

function isVersionOneGroupsLane(
  value: unknown,
): value is ListOrganizationGroupsResponse {
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
            "memberCount",
          ])),
    )
  );
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
    value.version === 1 &&
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
      (key) => key !== "directory" && key !== "groups",
    )
  ) {
    return false;
  }
  const directory = Reflect.get(value.lanes, "directory");
  const groups = Reflect.get(value.lanes, "groups");
  const validDirectory =
    directory === undefined || isVersionOneDirectoryLane(directory);
  const validGroups =
    groups === undefined ||
    (isVersionOneGroupsLane(groups) &&
      groups.groups.every(
        (group) => group.organizationId === value.organizationId,
      ));
  if (!validDirectory || !validGroups) {
    return false;
  }
  if (
    (directory && directory.organizationId !== value.organizationId) ||
    (groups && groups.organizationId !== value.organizationId)
  ) {
    return false;
  }

  if (value.mode === "snapshot") {
    return directory !== undefined && groups !== undefined && !value.hasMore;
  }

  return value.mode === "delta";
}
