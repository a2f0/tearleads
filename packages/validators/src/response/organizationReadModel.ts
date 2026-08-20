import { z } from "zod";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import { organizationReadModelResponseRuntimeRefinements } from "../organizationReadModelRefinements";
import { arraySchema } from "../schema";
import {
  OrganizationContainerGrantResponseShape,
  OrganizationDirectoryCurrentUserResponseShape,
  OrganizationDirectoryUserResponseShape,
  OrganizationGroupCurrentStateResponseShape,
  OrganizationGroupMemberResponseShape,
  OrganizationGroupSummaryResponseShape,
} from "./organization";

const OrganizationReadModelDirectoryUserResponseSchema = z.strictObject(
  OrganizationDirectoryUserResponseShape,
);

export const OrganizationReadModelDirectoryResponseSchema = z.strictObject({
  organizationId: z.string(),
  profileDocumentId: z.string().nullable(),
  users: arraySchema(OrganizationReadModelDirectoryUserResponseSchema),
});

export type OrganizationReadModelDirectoryResponse = z.infer<
  typeof OrganizationReadModelDirectoryResponseSchema
>;

const OrganizationReadModelGrantResponseSchema = z.strictObject(
  OrganizationContainerGrantResponseShape,
);

export const OrganizationReadModelGrantsResponseSchema = z.strictObject({
  grants: arraySchema(OrganizationReadModelGrantResponseSchema),
  organizationId: z.string(),
});

export type OrganizationReadModelGrantsResponse = z.infer<
  typeof OrganizationReadModelGrantsResponseSchema
>;

const OrganizationReadModelGroupMemberResponseSchema = z.strictObject(
  OrganizationGroupMemberResponseShape,
);

export const OrganizationReadModelGroupMembershipResponseSchema =
  z.strictObject({
    groupId: z.string(),
    members: arraySchema(OrganizationReadModelGroupMemberResponseSchema),
    stateHash: z.string().min(1),
  });

export type OrganizationReadModelGroupMembershipResponse = z.infer<
  typeof OrganizationReadModelGroupMembershipResponseSchema
>;

export const OrganizationReadModelGroupMembershipsResponseSchema =
  z.strictObject({
    deletedGroupIds: arraySchema(z.string().min(1)),
    groups: arraySchema(OrganizationReadModelGroupMembershipResponseSchema),
    organizationId: z.string(),
  });

export type OrganizationReadModelGroupMembershipsResponse = z.infer<
  typeof OrganizationReadModelGroupMembershipsResponseSchema
>;

const OrganizationReadModelGroupCurrentStateResponseSchema = z.strictObject(
  OrganizationGroupCurrentStateResponseShape,
);

const OrganizationReadModelGroupSummaryResponseSchema = z.strictObject({
  ...OrganizationGroupSummaryResponseShape,
  currentState: OrganizationReadModelGroupCurrentStateResponseSchema.nullable(),
});

const OrganizationReadModelGroupsResponseSchema = z.strictObject({
  groups: arraySchema(OrganizationReadModelGroupSummaryResponseSchema),
  memberGroupId: z.string(),
  organizationId: z.string(),
});

export const OrganizationReadModelOrganizationPolicyResponseSchema =
  z.strictObject({
    currentState: z.strictObject({
      ...OrganizationGroupCurrentStateResponseShape,
      stateHash: z.string().min(1),
    }),
    organizationId: z.string(),
  });

export type OrganizationReadModelOrganizationPolicyResponse = z.infer<
  typeof OrganizationReadModelOrganizationPolicyResponseSchema
>;

const OrganizationReadModelCurrentUserResponseSchema = z.strictObject(
  OrganizationDirectoryCurrentUserResponseShape,
);

const OrganizationReadModelResponseBaseShape = {
  currentUser: OrganizationReadModelCurrentUserResponseSchema,
  hasMore: z.boolean(),
  nextCursor: z.string().min(1),
  organizationId: z.string(),
  version: z.literal(6),
};

export const OrganizationReadModelSnapshotResponseSchema = z.strictObject({
  ...OrganizationReadModelResponseBaseShape,
  hasMore: z.literal(false),
  lanes: z.strictObject({
    directory: OrganizationReadModelDirectoryResponseSchema,
    grants: OrganizationReadModelGrantsResponseSchema,
    groupMemberships: OrganizationReadModelGroupMembershipsResponseSchema,
    groups: OrganizationReadModelGroupsResponseSchema,
    organizationPolicy: OrganizationReadModelOrganizationPolicyResponseSchema,
  }),
  mode: z.literal("snapshot"),
});

export type OrganizationReadModelSnapshotResponse = z.infer<
  typeof OrganizationReadModelSnapshotResponseSchema
>;

export const OrganizationReadModelDeltaResponseSchema = z.strictObject({
  ...OrganizationReadModelResponseBaseShape,
  lanes: z.strictObject({
    directory: OrganizationReadModelDirectoryResponseSchema.optional(),
    grants: OrganizationReadModelGrantsResponseSchema.optional(),
    groupMemberships:
      OrganizationReadModelGroupMembershipsResponseSchema.optional(),
    groups: OrganizationReadModelGroupsResponseSchema.optional(),
    organizationPolicy:
      OrganizationReadModelOrganizationPolicyResponseSchema.optional(),
  }),
  mode: z.literal("delta"),
});

export type OrganizationReadModelDeltaResponse = z.infer<
  typeof OrganizationReadModelDeltaResponseSchema
>;

const OrganizationReadModelResponseSchemaView = z.discriminatedUnion("mode", [
  OrganizationReadModelDeltaResponseSchema,
  OrganizationReadModelSnapshotResponseSchema,
]);

type OrganizationReadModelResponseView = z.infer<
  typeof OrganizationReadModelResponseSchemaView
>;

function hasValidGrantSubjectFields(
  grant: z.infer<typeof OrganizationReadModelGrantResponseSchema>,
): boolean {
  if (grant.subjectType === "user") {
    return (
      grant.userId === grant.subjectId &&
      grant.groupId === null &&
      grant.groupName === null
    );
  }
  if (grant.subjectType === "group") {
    return (
      grant.userId === null &&
      grant.signingKeyFingerprint === null &&
      grant.groupId === grant.subjectId
    );
  }
  return false;
}

function hasValidGrants(
  grants: OrganizationReadModelGrantsResponse["grants"],
): boolean {
  const keys = new Set<string>();
  return grants.every((grant) => {
    const key = `${grant.subjectType}:${grant.subjectId}:${grant.containerId}`;
    if (!hasValidGrantSubjectFields(grant) || keys.has(key)) {
      return false;
    }
    keys.add(key);
    return true;
  });
}

function hasValidGroupMemberships(
  lane: OrganizationReadModelGroupMembershipsResponse,
): boolean {
  const groupIds = new Set<string>();
  const validGroups = lane.groups.every((group) => {
    if (groupIds.has(group.groupId)) {
      return false;
    }
    groupIds.add(group.groupId);
    const memberIds = new Set<string>();
    return group.members.every((member) => {
      if (memberIds.has(member.userId)) {
        return false;
      }
      memberIds.add(member.userId);
      return true;
    });
  });
  if (!validGroups) {
    return false;
  }

  const deletedGroupIds = new Set<string>();
  return lane.deletedGroupIds.every((groupId) => {
    if (groupIds.has(groupId) || deletedGroupIds.has(groupId)) {
      return false;
    }
    deletedGroupIds.add(groupId);
    return true;
  });
}

function laneOrganizationsMatch(
  value: OrganizationReadModelResponseView,
): boolean {
  const { lanes, organizationId } = value;
  return (
    (lanes.directory === undefined ||
      lanes.directory.organizationId === organizationId) &&
    (lanes.grants === undefined ||
      lanes.grants.organizationId === organizationId) &&
    (lanes.groupMemberships === undefined ||
      lanes.groupMemberships.organizationId === organizationId) &&
    (lanes.groups === undefined ||
      (lanes.groups.organizationId === organizationId &&
        lanes.groups.groups.every(
          (group) => group.organizationId === organizationId,
        ))) &&
    (lanes.organizationPolicy === undefined ||
      lanes.organizationPolicy.organizationId === organizationId)
  );
}

function hasValidReadModelSemantics(
  value: OrganizationReadModelResponseView,
): boolean {
  if (
    !laneOrganizationsMatch(value) ||
    (value.lanes.grants !== undefined &&
      !hasValidGrants(value.lanes.grants.grants)) ||
    (value.lanes.groupMemberships !== undefined &&
      !hasValidGroupMemberships(value.lanes.groupMemberships))
  ) {
    return false;
  }

  return (
    value.mode === "delta" ||
    value.lanes.groupMemberships.deletedGroupIds.length === 0
  );
}

export const OrganizationReadModelResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      OrganizationReadModelResponseSchemaView.refine(
        hasValidReadModelSemantics,
      ),
      OrganizationReadModelResponseSchemaView,
    ),
    organizationReadModelResponseRuntimeRefinements,
  );

export type OrganizationReadModelResponse = z.infer<
  typeof OrganizationReadModelResponseSchema
>;

export function isOrganizationReadModelResponse(
  value: unknown,
): value is OrganizationReadModelResponse {
  return OrganizationReadModelResponseSchema.safeParse(value).success;
}
