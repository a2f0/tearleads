import type { z } from "zod";
import { loosePlainObject } from "../schema";
import { ContainerMutationResponseShape } from "./container";
import { OrganizationGroupSummaryResponseSchema } from "./organization";
import { OrganizationReadModelDeltaSchema } from "./organizationReadModel";
import { PrincipalPolicyMutationResponseSchema } from "./principal";

/**
 * The read-model delta a mutation response may carry for the cursor its
 * caller held (`readModelCursor`). Present only when that cursor was the head
 * the commit advanced from and the caller may read the feed; otherwise the
 * caller reads the feed as before.
 */
const committedReadModel = OrganizationReadModelDeltaSchema.optional();

export const CreateOrganizationGroupResponseSchema = loosePlainObject({
  group: OrganizationGroupSummaryResponseSchema,
  organizationPolicy: PrincipalPolicyMutationResponseSchema,
  readModel: committedReadModel,
});

export type CreateOrganizationGroupResponse = z.infer<
  typeof CreateOrganizationGroupResponseSchema
>;

export function isCreateOrganizationGroupResponse(
  value: unknown,
): value is CreateOrganizationGroupResponse {
  return CreateOrganizationGroupResponseSchema.safeParse(value).success;
}

export const CommitOrganizationGroupPolicyResponseSchema = loosePlainObject({
  groupPolicy: PrincipalPolicyMutationResponseSchema,
  memberPolicy: PrincipalPolicyMutationResponseSchema.optional(),
  organizationPolicy: PrincipalPolicyMutationResponseSchema,
  readModel: committedReadModel,
});

export type CommitOrganizationGroupPolicyResponse = z.infer<
  typeof CommitOrganizationGroupPolicyResponseSchema
>;

export function isCommitOrganizationGroupPolicyResponse(
  value: unknown,
): value is CommitOrganizationGroupPolicyResponse {
  return CommitOrganizationGroupPolicyResponseSchema.safeParse(value).success;
}

export const ContainerShareResponseSchema = loosePlainObject({
  ...ContainerMutationResponseShape,
  readModel: committedReadModel,
});

export type ContainerShareResponse = z.infer<
  typeof ContainerShareResponseSchema
>;

export function isContainerShareResponse(
  value: unknown,
): value is ContainerShareResponse {
  return ContainerShareResponseSchema.safeParse(value).success;
}
