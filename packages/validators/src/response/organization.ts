import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasBooleanProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
} from "../util";

export type OrganizationRole = "member" | "admin";

export interface OrganizationDirectoryUserResponse {
  userId: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
  createdAt: string;
  isSelf: boolean;
}

export interface OrganizationDirectoryResponse {
  organizationId: string;
  currentUser: {
    isOrgAdmin: boolean;
  };
  users: OrganizationDirectoryUserResponse[];
}

export interface OrganizationGroupCurrentStateResponse {
  stateHash: string;
  version: number;
  keyEpoch: number;
  memberCount: number;
}

export interface OrganizationGroupSummaryResponse {
  groupId: string;
  organizationId: string;
  name: string;
  createdAt: string;
  currentState: OrganizationGroupCurrentStateResponse | null;
}

export interface ListOrganizationGroupsResponse {
  organizationId: string;
  groups: OrganizationGroupSummaryResponse[];
}

export interface OrganizationGroupMemberResponse {
  memberPrincipalType: "user" | "group";
  memberPrincipalId: string;
  role: OrganizationRole;
  userId: string | null;
  signingKeyFingerprint: string | null;
  signingPublicKey: string | null;
  encapsulationPublicKey: string | null;
  encapsulationKeyFingerprint: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface OrganizationGroupMembersResponse {
  organizationId: string;
  groupId: string;
  members: OrganizationGroupMemberResponse[];
}

function isOrganizationRole(value: string): value is OrganizationRole {
  return value === "member" || value === "admin";
}

function isPrincipalMemberType(value: string): value is "user" | "group" {
  return value === "user" || value === "group";
}

export function isOrganizationDirectoryUserResponse(
  value: unknown,
): value is OrganizationDirectoryUserResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "signingKeyFingerprint") &&
    hasStringProperty(value, "signingPublicKey") &&
    hasStringProperty(value, "encapsulationPublicKey") &&
    hasStringProperty(value, "encapsulationKeyFingerprint") &&
    hasStringProperty(value, "createdAt") &&
    hasBooleanProperty(value, "isSelf")
  );
}

function isOrganizationDirectoryCurrentUserResponse(
  value: unknown,
): value is OrganizationDirectoryResponse["currentUser"] {
  return isPlainObject(value) && hasBooleanProperty(value, "isOrgAdmin");
}

export function isOrganizationDirectoryResponse(
  value: unknown,
): value is OrganizationDirectoryResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasObjectProperty(value, "currentUser") &&
    isOrganizationDirectoryCurrentUserResponse(value.currentUser) &&
    hasArrayProperty(value, "users") &&
    value.users.every(isOrganizationDirectoryUserResponse)
  );
}

export function isOrganizationGroupCurrentStateResponse(
  value: unknown,
): value is OrganizationGroupCurrentStateResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stateHash") &&
    hasNumberProperty(value, "version") &&
    Number.isInteger(value.version) &&
    value.version > 0 &&
    hasNumberProperty(value, "keyEpoch") &&
    Number.isInteger(value.keyEpoch) &&
    value.keyEpoch > 0 &&
    hasNumberProperty(value, "memberCount") &&
    Number.isInteger(value.memberCount) &&
    value.memberCount >= 0
  );
}

export function isOrganizationGroupSummaryResponse(
  value: unknown,
): value is OrganizationGroupSummaryResponse {
  const currentState = isPlainObject(value)
    ? Reflect.get(value, "currentState")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "groupId") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "name") &&
    hasStringProperty(value, "createdAt") &&
    (currentState === null ||
      isOrganizationGroupCurrentStateResponse(currentState))
  );
}

export function isListOrganizationGroupsResponse(
  value: unknown,
): value is ListOrganizationGroupsResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasArrayProperty(value, "groups") &&
    value.groups.every(isOrganizationGroupSummaryResponse)
  );
}

export function isOrganizationGroupMemberResponse(
  value: unknown,
): value is OrganizationGroupMemberResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "memberPrincipalType") &&
    isPrincipalMemberType(value.memberPrincipalType) &&
    hasStringProperty(value, "memberPrincipalId") &&
    hasStringProperty(value, "role") &&
    isOrganizationRole(value.role) &&
    hasNullableStringProperty(value, "userId") &&
    hasNullableStringProperty(value, "signingKeyFingerprint") &&
    hasNullableStringProperty(value, "signingPublicKey") &&
    hasNullableStringProperty(value, "encapsulationPublicKey") &&
    hasNullableStringProperty(value, "encapsulationKeyFingerprint") &&
    hasNullableStringProperty(value, "groupId") &&
    hasNullableStringProperty(value, "groupName")
  );
}

export function isOrganizationGroupMembersResponse(
  value: unknown,
): value is OrganizationGroupMembersResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "groupId") &&
    hasArrayProperty(value, "members") &&
    value.members.every(isOrganizationGroupMemberResponse)
  );
}

export function isCreateOrganizationGroupResponse(
  value: unknown,
): value is OrganizationGroupSummaryResponse {
  return isOrganizationGroupSummaryResponse(value);
}
