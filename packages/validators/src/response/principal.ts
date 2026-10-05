import { z } from "zod";
import { arraySchema, loosePlainObject, nonEmptyStringSchema } from "../schema";
import { MAX_ROTATION_CONTAINER_REKEYS } from "../util";
import { ContainerMutationResponseSchema } from "./container";
import { CONTAINER_DESCENDANT_REKEYS_REQUIRED_ERROR_CODE } from "./descendantRekeysRequiredError";
import { BillingErrorResponseSchema } from "./organizationBilling";

import {
  CurrentPrincipalMemberEnvelopesResponseSchema,
  PrincipalContainerGrantResponseSchema,
  PrincipalPolicyStateChainEntryResponseSchema,
  PrincipalProjectionMemberResponseSchema,
  PrincipalStatePayloadResponseSchema,
  PrincipalStateResponseSchema,
} from "./principalSnapshot";

export {
  type CurrentPrincipalMemberEnvelopesResponse,
  CurrentPrincipalMemberEnvelopesResponseSchema,
  isCurrentPrincipalMemberEnvelopesResponse,
  isPrincipalPolicyStateChainEntryResponse,
  isPrincipalStatePayloadResponse,
  isPrincipalStateResponse,
  type PrincipalContainerGrantResponse,
  PrincipalContainerGrantResponseSchema,
  type PrincipalMemberEnvelopeResponse,
  PrincipalMemberEnvelopeResponseSchema,
  type PrincipalPolicySnapshotResponse,
  PrincipalPolicySnapshotResponseSchema,
  type PrincipalPolicyStateChainEntryResponse,
  PrincipalPolicyStateChainEntryResponseSchema,
  type PrincipalProjectionMemberResponse,
  PrincipalProjectionMemberResponseSchema,
  type PrincipalStateExternalAuthorityResponse,
  PrincipalStateExternalAuthorityResponseSchema,
  type PrincipalStatePayloadResponse,
  PrincipalStatePayloadResponseSchema,
  type PrincipalStateResponse,
  PrincipalStateResponseSchema,
} from "./principalSnapshot";

const principalPolicyCurrentResponseShape = {
  currentGrants: arraySchema(PrincipalContainerGrantResponseSchema),
  currentMemberEnvelopes: CurrentPrincipalMemberEnvelopesResponseSchema,
  currentPayload: PrincipalStatePayloadResponseSchema,
  currentProjection: arraySchema(PrincipalProjectionMemberResponseSchema),
  currentState: PrincipalStateResponseSchema,
};

export const PrincipalPolicyBundleResponseSchema = loosePlainObject({
  ...principalPolicyCurrentResponseShape,
  previousStates: arraySchema(PrincipalPolicyStateChainEntryResponseSchema),
});

export type PrincipalPolicyBundleResponse = z.infer<
  typeof PrincipalPolicyBundleResponseSchema
>;

export const PrincipalPolicyMutationResponseSchema = loosePlainObject({
  ...principalPolicyCurrentResponseShape,
  containerMutations: arraySchema(ContainerMutationResponseSchema),
});

export type PrincipalPolicyMutationResponse = z.infer<
  typeof PrincipalPolicyMutationResponseSchema
>;

export const CommitOrganizationGroupPolicyResponseSchema = loosePlainObject({
  groupPolicy: PrincipalPolicyMutationResponseSchema,
  organizationPolicy: PrincipalPolicyMutationResponseSchema,
});

export type CommitOrganizationGroupPolicyResponse = z.infer<
  typeof CommitOrganizationGroupPolicyResponseSchema
>;

export const PrincipalPolicyErrorResponseSchema = BillingErrorResponseSchema;

export type PrincipalPolicyErrorResponse = z.infer<
  typeof PrincipalPolicyErrorResponseSchema
>;

/**
 * A group policy change rematerializes its granted containers, and a rekey or
 * revoke among them is a rotation like any other: one that would leave a level
 * above a directly granted container pinned to a retired epoch is refused, and
 * this names the descendant rekeys the batch must carry, parent-first.
 */
const PrincipalPolicyDescendantRekeysRequiredResponseSchema = loosePlainObject({
  code: z.literal(CONTAINER_DESCENDANT_REKEYS_REQUIRED_ERROR_CODE),
  error: z.string().min(1),
  requiredContainerIds: arraySchema(
    nonEmptyStringSchema,
    MAX_ROTATION_CONTAINER_REKEYS,
  ),
});

/**
 * The commit's conflict envelope alone: only a group commit carries container
 * mutations, so only it can be refused for what they strand. The principal
 * policy read and the organization policy write keep the plain envelope.
 */
export const CommitOrganizationGroupPolicyConflictResponseSchema = z.union([
  PrincipalPolicyErrorResponseSchema,
  PrincipalPolicyDescendantRekeysRequiredResponseSchema,
]);

export const PrincipalPolicyStaleErrorResponseSchema = loosePlainObject({
  code: z.literal("principal_policy_stale"),
  error: z.string().min(1),
  principalPolicies: arraySchema(PrincipalPolicyBundleResponseSchema),
});

export type PrincipalPolicyStaleErrorResponse = z.infer<
  typeof PrincipalPolicyStaleErrorResponseSchema
>;

export function isPrincipalPolicyBundleResponse(
  value: unknown,
): value is PrincipalPolicyBundleResponse {
  return PrincipalPolicyBundleResponseSchema.safeParse(value).success;
}

export function isPrincipalPolicyMutationResponse(
  value: unknown,
): value is PrincipalPolicyMutationResponse {
  return PrincipalPolicyMutationResponseSchema.safeParse(value).success;
}

export function isCommitOrganizationGroupPolicyResponse(
  value: unknown,
): value is CommitOrganizationGroupPolicyResponse {
  return CommitOrganizationGroupPolicyResponseSchema.safeParse(value).success;
}

export function isPrincipalPolicyStaleErrorResponse(
  value: unknown,
): value is PrincipalPolicyStaleErrorResponse {
  return PrincipalPolicyStaleErrorResponseSchema.safeParse(value).success;
}
