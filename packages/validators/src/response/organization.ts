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
export type OrganizationRosterStatus = "active" | "disabled";

export interface OrganizationDirectoryUserResponse {
  userId: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
  createdAt: string;
  isSelf: boolean;
  status: OrganizationRosterStatus;
  profileDocumentId: string | null;
  joinedAt: string;
  disabledAt: string | null;
  disabledByUserId: string | null;
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
  isBuiltin: boolean;
  currentState: OrganizationGroupCurrentStateResponse | null;
}

export interface DeleteOrganizationGroupResponse {
  deleted: true;
  groupId: string;
  organizationId: string;
}

export interface ListOrganizationGroupsResponse {
  organizationId: string;
  memberGroupId?: string | undefined;
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

export type OrganizationGroupContainerAccessLevel = "admin" | "read" | "write";
export type OrganizationContainerGrantSubjectType =
  | "group"
  | "organization"
  | "user";

export interface OrganizationGroupContainerResponse {
  accessLevel: OrganizationGroupContainerAccessLevel;
  containerId: string;
  createdAt: string;
  depth: number;
  isBuiltin: boolean;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string | null;
  parentId: string | null;
  updatedAt: string;
}

export interface OrganizationGroupContainersResponse {
  organizationId: string;
  groupId: string;
  containers: OrganizationGroupContainerResponse[];
}

export interface OrganizationContainerGrantResponse
  extends OrganizationGroupContainerResponse {
  subjectType: OrganizationContainerGrantSubjectType;
  subjectId: string;
  userId: string | null;
  signingKeyFingerprint: string | null;
  groupId: string | null;
  groupName: string | null;
  organizationName: string | null;
}

export interface OrganizationContainerGrantsResponse {
  organizationId: string;
  grants: OrganizationContainerGrantResponse[];
}

export interface OrganizationDocumentDataUsageResponse {
  byteLength: number;
  documentCount: number;
  updateCount: number;
}

export interface OrganizationBlobDataUsageResponse {
  blobCount: number;
  byteLength: number;
}

export interface OrganizationDataUsageResponse {
  organizationId: string;
  blobs: OrganizationBlobDataUsageResponse;
  documents: OrganizationDocumentDataUsageResponse;
  totalByteLength: number;
}

export interface OrganizationUserDetailGrantsResponse {
  directGrants: OrganizationContainerGrantResponse[];
  groupGrants: OrganizationContainerGrantResponse[];
  organizationGrants: OrganizationContainerGrantResponse[];
}

export interface OrganizationUserDetailResponse {
  organizationId: string;
  user: OrganizationDirectoryUserResponse;
  groups: OrganizationGroupSummaryResponse[];
  grants: OrganizationUserDetailGrantsResponse;
}

function isOrganizationRole(value: string): value is OrganizationRole {
  return value === "member" || value === "admin";
}

function isOrganizationRosterStatus(
  value: string,
): value is OrganizationRosterStatus {
  return value === "active" || value === "disabled";
}

function isPrincipalMemberType(value: string): value is "user" | "group" {
  return value === "user" || value === "group";
}

export function isOrganizationGroupContainerAccessLevel(
  value: string,
): value is OrganizationGroupContainerAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

export function isOrganizationContainerGrantSubjectType(
  value: string,
): value is OrganizationContainerGrantSubjectType {
  return value === "group" || value === "organization" || value === "user";
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
    hasBooleanProperty(value, "isSelf") &&
    hasStringProperty(value, "status") &&
    isOrganizationRosterStatus(value.status) &&
    hasNullableStringProperty(value, "profileDocumentId") &&
    hasStringProperty(value, "joinedAt") &&
    hasNullableStringProperty(value, "disabledAt") &&
    hasNullableStringProperty(value, "disabledByUserId")
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
    hasBooleanProperty(value, "isBuiltin") &&
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
    (!Reflect.has(value, "memberGroupId") ||
      hasStringProperty(value, "memberGroupId")) &&
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

export function isOrganizationGroupContainerResponse(
  value: unknown,
): value is OrganizationGroupContainerResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "accessLevel") &&
    isOrganizationGroupContainerAccessLevel(value.accessLevel) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "createdAt") &&
    hasNumberProperty(value, "depth") &&
    Number.isInteger(value.depth) &&
    value.depth >= 0 &&
    hasBooleanProperty(value, "isBuiltin") &&
    hasNumberProperty(value, "metadataAccessEpoch") &&
    Number.isInteger(value.metadataAccessEpoch) &&
    value.metadataAccessEpoch > 0 &&
    hasStringProperty(value, "metadataAccessStateHash") &&
    value.metadataAccessStateHash.length > 0 &&
    hasNullableStringProperty(value, "metadataDocumentId") &&
    hasNullableStringProperty(value, "parentId") &&
    hasStringProperty(value, "updatedAt")
  );
}

export function isOrganizationGroupContainersResponse(
  value: unknown,
): value is OrganizationGroupContainersResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "groupId") &&
    hasArrayProperty(value, "containers") &&
    value.containers.every(isOrganizationGroupContainerResponse)
  );
}

export function isOrganizationContainerGrantResponse(
  value: unknown,
): value is OrganizationContainerGrantResponse {
  return (
    isPlainObject(value) &&
    isOrganizationGroupContainerResponse(value) &&
    hasStringProperty(value, "subjectType") &&
    isOrganizationContainerGrantSubjectType(value.subjectType) &&
    hasStringProperty(value, "subjectId") &&
    hasNullableStringProperty(value, "userId") &&
    hasNullableStringProperty(value, "signingKeyFingerprint") &&
    hasNullableStringProperty(value, "groupId") &&
    hasNullableStringProperty(value, "groupName") &&
    hasNullableStringProperty(value, "organizationName")
  );
}

export function isOrganizationContainerGrantsResponse(
  value: unknown,
): value is OrganizationContainerGrantsResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasArrayProperty(value, "grants") &&
    value.grants.every(isOrganizationContainerGrantResponse)
  );
}

function isNonNegativeIntegerProperty(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const property = Reflect.get(value, key);

  return (
    typeof property === "number" && Number.isInteger(property) && property >= 0
  );
}

function isOrganizationDocumentDataUsageResponse(
  value: unknown,
): value is OrganizationDocumentDataUsageResponse {
  return (
    isPlainObject(value) &&
    isNonNegativeIntegerProperty(value, "byteLength") &&
    isNonNegativeIntegerProperty(value, "documentCount") &&
    isNonNegativeIntegerProperty(value, "updateCount")
  );
}

function isOrganizationBlobDataUsageResponse(
  value: unknown,
): value is OrganizationBlobDataUsageResponse {
  return (
    isPlainObject(value) &&
    isNonNegativeIntegerProperty(value, "blobCount") &&
    isNonNegativeIntegerProperty(value, "byteLength")
  );
}

export function isOrganizationDataUsageResponse(
  value: unknown,
): value is OrganizationDataUsageResponse {
  const blobs = isPlainObject(value) ? Reflect.get(value, "blobs") : undefined;
  const documents = isPlainObject(value)
    ? Reflect.get(value, "documents")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    isOrganizationBlobDataUsageResponse(blobs) &&
    isOrganizationDocumentDataUsageResponse(documents) &&
    isNonNegativeIntegerProperty(value, "totalByteLength")
  );
}

export function isOrganizationUserDetailGrantsResponse(
  value: unknown,
): value is OrganizationUserDetailGrantsResponse {
  return (
    isPlainObject(value) &&
    hasArrayProperty(value, "directGrants") &&
    value.directGrants.every(isOrganizationContainerGrantResponse) &&
    hasArrayProperty(value, "groupGrants") &&
    value.groupGrants.every(isOrganizationContainerGrantResponse) &&
    hasArrayProperty(value, "organizationGrants") &&
    value.organizationGrants.every(isOrganizationContainerGrantResponse)
  );
}

export function isOrganizationUserDetailResponse(
  value: unknown,
): value is OrganizationUserDetailResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "organizationId") &&
    hasObjectProperty(value, "user") &&
    isOrganizationDirectoryUserResponse(value.user) &&
    hasArrayProperty(value, "groups") &&
    value.groups.every(isOrganizationGroupSummaryResponse) &&
    hasObjectProperty(value, "grants") &&
    isOrganizationUserDetailGrantsResponse(value.grants)
  );
}

export function isCreateOrganizationGroupResponse(
  value: unknown,
): value is OrganizationGroupSummaryResponse {
  return isOrganizationGroupSummaryResponse(value);
}

export function isDeleteOrganizationGroupResponse(
  value: unknown,
): value is DeleteOrganizationGroupResponse {
  return (
    isPlainObject(value) &&
    Reflect.get(value, "deleted") === true &&
    hasStringProperty(value, "groupId") &&
    hasStringProperty(value, "organizationId")
  );
}
