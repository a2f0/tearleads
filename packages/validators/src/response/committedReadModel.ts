import { z } from "zod";
import { registerJsonSchemaView } from "../jsonSchema";
import { loosePlainObject } from "../schema";
import { ContainerMutationResponseShape } from "./container";
import { OrganizationGroupSummaryResponseSchema } from "./organization";
import {
  type OrganizationReadModelDeltaResponse,
  OrganizationReadModelDeltaSchema,
} from "./organizationReadModel";
import { PrincipalPolicyMutationResponseSchema } from "./principal";

/**
 * The read-model delta a mutation response may carry for the cursor its
 * caller held (`readModelCursor`). Present only when that cursor was the head
 * the commit advanced from and the caller may read the feed; otherwise the
 * caller reads the feed as before. The receipt does not depend on it: a
 * response validates whatever this field holds, and a client applies it only
 * after `committedReadModelDelta` accepts it, so a malformed delta costs a
 * feed read, never the acknowledgement.
 */
const committedReadModel = registerJsonSchemaView(
  z.unknown().optional(),
  OrganizationReadModelDeltaSchema.optional(),
);

function isOrganizationReadModelDelta(
  value: unknown,
): value is OrganizationReadModelDeltaResponse {
  return OrganizationReadModelDeltaSchema.safeParse(value).success;
}

/** The delta a mutation response carried, if well formed for `organizationId`. */
export function committedReadModelDelta(
  value: unknown,
  organizationId: string,
): OrganizationReadModelDeltaResponse | undefined {
  return isOrganizationReadModelDelta(value) &&
    value.organizationId === organizationId
    ? value
    : undefined;
}

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
