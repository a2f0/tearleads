import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
} from "../schema";
import { PrincipalPolicyMutationResponseSchema } from "./principal";

const OrganizationRoleSchema = z.literal(["member", "admin"]);
const OrganizationRosterStatusSchema = z.literal(["active", "disabled"]);
const OrganizationGroupContainerAccessLevelSchema = z.literal([
  "admin",
  "read",
  "write",
]);
const OrganizationContainerGrantSubjectTypeSchema = z.literal([
  "group",
  "organization",
  "user",
]);

export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;
export type OrganizationRosterStatus = z.infer<
  typeof OrganizationRosterStatusSchema
>;
export type OrganizationGroupContainerAccessLevel = z.infer<
  typeof OrganizationGroupContainerAccessLevelSchema
>;
export type OrganizationContainerGrantSubjectType = z.infer<
  typeof OrganizationContainerGrantSubjectTypeSchema
>;

export const OrganizationDirectoryUserResponseShape = {
  createdAt: z.string(),
  disabledAt: z.string().nullable(),
  disabledByUserId: z.string().nullable(),
  encapsulationKeyFingerprint: z.string(),
  encapsulationPublicKey: z.string(),
  isSelf: z.boolean(),
  joinedAt: z.string(),
  profileDocumentId: z.string().nullable(),
  signingKeyFingerprint: z.string(),
  signingPublicKey: z.string(),
  status: OrganizationRosterStatusSchema,
  updatedAt: z.string(),
  userId: z.string(),
};

export const OrganizationDirectoryUserResponseSchema = loosePlainObject(
  OrganizationDirectoryUserResponseShape,
);

export type OrganizationDirectoryUserResponse = z.infer<
  typeof OrganizationDirectoryUserResponseSchema
>;

export const OrganizationDirectoryCurrentUserResponseShape = {
  isOrgAdmin: z.boolean(),
};

const OrganizationDirectoryCurrentUserResponseSchema = loosePlainObject(
  OrganizationDirectoryCurrentUserResponseShape,
);

export const OrganizationDirectoryResponseSchema = loosePlainObject({
  currentUser: OrganizationDirectoryCurrentUserResponseSchema,
  organizationId: z.string(),
  profileDocumentId: z.string().nullable(),
  users: arraySchema(OrganizationDirectoryUserResponseSchema),
});

export type OrganizationDirectoryResponse = z.infer<
  typeof OrganizationDirectoryResponseSchema
>;

export const OrganizationProfileResponseSchema = loosePlainObject({
  organizationId: z.string(),
  profileDocumentId: z.string().nullable(),
});

export type OrganizationProfileResponse = z.infer<
  typeof OrganizationProfileResponseSchema
>;

export const OrganizationGroupCurrentStateResponseShape = {
  keyEpoch: positiveIntegerSchema,
  keyFingerprint: nonEmptyStringSchema,
  memberCount: nonNegativeIntegerSchema,
  stateHash: z.string(),
  version: positiveIntegerSchema,
};

export const OrganizationGroupCurrentStateResponseSchema = loosePlainObject(
  OrganizationGroupCurrentStateResponseShape,
);

export type OrganizationGroupCurrentStateResponse = z.infer<
  typeof OrganizationGroupCurrentStateResponseSchema
>;

export const OrganizationGroupSummaryResponseShape = {
  createdAt: z.string(),
  currentState: OrganizationGroupCurrentStateResponseSchema.nullable(),
  groupId: z.string(),
  isBuiltin: z.boolean(),
  name: z.string(),
  organizationId: z.string(),
};

export const OrganizationGroupSummaryResponseSchema = loosePlainObject(
  OrganizationGroupSummaryResponseShape,
);

export type OrganizationGroupSummaryResponse = z.infer<
  typeof OrganizationGroupSummaryResponseSchema
>;

export const CreateOrganizationGroupResponseSchema = loosePlainObject({
  group: OrganizationGroupSummaryResponseSchema,
  organizationPolicy: PrincipalPolicyMutationResponseSchema,
});

export type CreateOrganizationGroupResponse = z.infer<
  typeof CreateOrganizationGroupResponseSchema
>;

export const DeleteOrganizationGroupResponseSchema = loosePlainObject({
  deleted: z.literal(true),
  groupId: z.string(),
  organizationId: z.string(),
});

export type DeleteOrganizationGroupResponse = z.infer<
  typeof DeleteOrganizationGroupResponseSchema
>;

export const ListOrganizationGroupsResponseSchema = loosePlainObject({
  groups: arraySchema(OrganizationGroupSummaryResponseSchema),
  memberGroupId: z.string(),
  organizationId: z.string(),
});

export type ListOrganizationGroupsResponse = z.infer<
  typeof ListOrganizationGroupsResponseSchema
>;

export const OrganizationGroupMemberResponseShape = {
  encapsulationKeyFingerprint: z.string().nullable(),
  encapsulationPublicKey: z.string().nullable(),
  role: OrganizationRoleSchema,
  signingKeyFingerprint: z.string().nullable(),
  signingPublicKey: z.string().nullable(),
  userId: z.string(),
};

export const OrganizationGroupMemberResponseSchema = loosePlainObject(
  OrganizationGroupMemberResponseShape,
);

export type OrganizationGroupMemberResponse = z.infer<
  typeof OrganizationGroupMemberResponseSchema
>;

export const OrganizationGroupMembersResponseSchema = loosePlainObject({
  groupId: z.string(),
  members: arraySchema(OrganizationGroupMemberResponseSchema),
  organizationId: z.string(),
});

export type OrganizationGroupMembersResponse = z.infer<
  typeof OrganizationGroupMembersResponseSchema
>;

const OrganizationGroupContainerResponseShape = {
  accessLevel: OrganizationGroupContainerAccessLevelSchema,
  containerId: z.string(),
  createdAt: z.string(),
  depth: nonNegativeIntegerSchema,
  isBuiltin: z.boolean(),
  metadataAccessEpoch: positiveIntegerSchema,
  metadataAccessStateHash: nonEmptyStringSchema,
  metadataDocumentId: z.string().nullable(),
  parentId: z.string().nullable(),
  updatedAt: z.string(),
};

export const OrganizationGroupContainerResponseSchema = loosePlainObject(
  OrganizationGroupContainerResponseShape,
);

export type OrganizationGroupContainerResponse = z.infer<
  typeof OrganizationGroupContainerResponseSchema
>;

export const OrganizationGroupContainersResponseSchema = loosePlainObject({
  containers: arraySchema(OrganizationGroupContainerResponseSchema),
  groupId: z.string(),
  organizationId: z.string(),
});

export type OrganizationGroupContainersResponse = z.infer<
  typeof OrganizationGroupContainersResponseSchema
>;

export const OrganizationContainerGrantResponseShape = {
  ...OrganizationGroupContainerResponseShape,
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  organizationName: z.string().nullable(),
  signingKeyFingerprint: z.string().nullable(),
  subjectId: z.string(),
  subjectType: OrganizationContainerGrantSubjectTypeSchema,
  userId: z.string().nullable(),
};

export const OrganizationContainerGrantResponseSchema = loosePlainObject(
  OrganizationContainerGrantResponseShape,
);

export type OrganizationContainerGrantResponse = z.infer<
  typeof OrganizationContainerGrantResponseSchema
>;

export const OrganizationContainerGrantsResponseSchema = loosePlainObject({
  grants: arraySchema(OrganizationContainerGrantResponseSchema),
  organizationId: z.string(),
});

export type OrganizationContainerGrantsResponse = z.infer<
  typeof OrganizationContainerGrantsResponseSchema
>;

export const OrganizationUserDetailGrantsResponseSchema = loosePlainObject({
  directGrants: arraySchema(OrganizationContainerGrantResponseSchema),
  groupGrants: arraySchema(OrganizationContainerGrantResponseSchema),
  organizationGrants: arraySchema(OrganizationContainerGrantResponseSchema),
});

export type OrganizationUserDetailGrantsResponse = z.infer<
  typeof OrganizationUserDetailGrantsResponseSchema
>;

export const OrganizationUserDetailResponseSchema = loosePlainObject({
  grants: OrganizationUserDetailGrantsResponseSchema,
  groups: arraySchema(OrganizationGroupSummaryResponseSchema),
  organizationId: z.string(),
  user: OrganizationDirectoryUserResponseSchema,
});

export type OrganizationUserDetailResponse = z.infer<
  typeof OrganizationUserDetailResponseSchema
>;

export function isOrganizationGroupContainerAccessLevel(
  value: string,
): value is OrganizationGroupContainerAccessLevel {
  return OrganizationGroupContainerAccessLevelSchema.safeParse(value).success;
}

export function isOrganizationContainerGrantSubjectType(
  value: string,
): value is OrganizationContainerGrantSubjectType {
  return OrganizationContainerGrantSubjectTypeSchema.safeParse(value).success;
}

export function isOrganizationDirectoryUserResponse(
  value: unknown,
): value is OrganizationDirectoryUserResponse {
  return OrganizationDirectoryUserResponseSchema.safeParse(value).success;
}

export function isOrganizationDirectoryResponse(
  value: unknown,
): value is OrganizationDirectoryResponse {
  return OrganizationDirectoryResponseSchema.safeParse(value).success;
}

export function isOrganizationProfileResponse(
  value: unknown,
): value is OrganizationProfileResponse {
  return OrganizationProfileResponseSchema.safeParse(value).success;
}

export function isOrganizationGroupCurrentStateResponse(
  value: unknown,
): value is OrganizationGroupCurrentStateResponse {
  return OrganizationGroupCurrentStateResponseSchema.safeParse(value).success;
}

export function isOrganizationGroupSummaryResponse(
  value: unknown,
): value is OrganizationGroupSummaryResponse {
  return OrganizationGroupSummaryResponseSchema.safeParse(value).success;
}

export function isListOrganizationGroupsResponse(
  value: unknown,
): value is ListOrganizationGroupsResponse {
  return ListOrganizationGroupsResponseSchema.safeParse(value).success;
}

export function isOrganizationGroupMemberResponse(
  value: unknown,
): value is OrganizationGroupMemberResponse {
  return OrganizationGroupMemberResponseSchema.safeParse(value).success;
}

export function isOrganizationGroupMembersResponse(
  value: unknown,
): value is OrganizationGroupMembersResponse {
  return OrganizationGroupMembersResponseSchema.safeParse(value).success;
}

export function isOrganizationGroupContainerResponse(
  value: unknown,
): value is OrganizationGroupContainerResponse {
  return OrganizationGroupContainerResponseSchema.safeParse(value).success;
}

export function isOrganizationGroupContainersResponse(
  value: unknown,
): value is OrganizationGroupContainersResponse {
  return OrganizationGroupContainersResponseSchema.safeParse(value).success;
}

export function isOrganizationContainerGrantResponse(
  value: unknown,
): value is OrganizationContainerGrantResponse {
  return OrganizationContainerGrantResponseSchema.safeParse(value).success;
}

export function isOrganizationContainerGrantsResponse(
  value: unknown,
): value is OrganizationContainerGrantsResponse {
  return OrganizationContainerGrantsResponseSchema.safeParse(value).success;
}

export function isOrganizationUserDetailGrantsResponse(
  value: unknown,
): value is OrganizationUserDetailGrantsResponse {
  return OrganizationUserDetailGrantsResponseSchema.safeParse(value).success;
}

export function isOrganizationUserDetailResponse(
  value: unknown,
): value is OrganizationUserDetailResponse {
  return OrganizationUserDetailResponseSchema.safeParse(value).success;
}

export function isCreateOrganizationGroupResponse(
  value: unknown,
): value is CreateOrganizationGroupResponse {
  return CreateOrganizationGroupResponseSchema.safeParse(value).success;
}

export function isDeleteOrganizationGroupResponse(
  value: unknown,
): value is DeleteOrganizationGroupResponse {
  return DeleteOrganizationGroupResponseSchema.safeParse(value).success;
}
