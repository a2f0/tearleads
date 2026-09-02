import { z } from "zod";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  CommitOrganizationGroupPolicyRequestSchema,
  isCommitOrganizationGroupPolicyRequest,
  isOrganizationPrincipalPolicyRequest,
  OrganizationPrincipalPolicyRequestSchema,
} from "../request";
import {
  CommitOrganizationGroupPolicyResponseSchema,
  ErrorResponseSchema,
  isCommitOrganizationGroupPolicyResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalPolicyMutationResponse,
  PaymentRequiredErrorResponseSchema,
  PrincipalPolicyBundleResponseSchema,
  PrincipalPolicyErrorResponseSchema,
  PrincipalPolicyMutationResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { uuidV4StringSchema } from "../schema";
import { defineJsonOperation } from "./definition";

export const PrincipalPolicyPathParamsSchema = z.strictObject({
  principalType: z.literal(["group", "organization"]),
  principalId: uuidV4StringSchema,
});

export type PrincipalPolicyPathParams = z.infer<
  typeof PrincipalPolicyPathParamsSchema
>;

export const OrganizationGroupPolicyPathParamsSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
  groupId: uuidV4StringSchema,
});

export type OrganizationGroupPolicyPathParams = z.infer<
  typeof OrganizationGroupPolicyPathParamsSchema
>;

export const getPrincipalPolicyOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: PrincipalPolicyErrorResponseSchema,
    401: SessionFailureResponseSchema,
    404: PrincipalPolicyErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 404, 500],
  id: "principals.policy.get",
  method: "GET",
  params: PrincipalPolicyPathParamsSchema,
  path: "/principals/{principalType}/{principalId}/policy",
  responses: {
    200: PrincipalPolicyBundleResponseSchema,
  },
});

export const putPrincipalPolicyOperation = defineJsonOperation({
  auth: "session",
  body: OrganizationPrincipalPolicyRequestSchema,
  failureResponses: {
    400: PrincipalPolicyErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: PrincipalPolicyErrorResponseSchema,
    404: PrincipalPolicyErrorResponseSchema,
    409: PrincipalPolicyErrorResponseSchema,
    500: ErrorResponseSchema,
    503: PrincipalPolicyErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 503],
  id: "principals.policy.update",
  method: "PUT",
  params: PrincipalPolicyPathParamsSchema,
  path: "/principals/{principalType}/{principalId}/policy",
  responses: {
    200: PrincipalPolicyMutationResponseSchema,
  },
  runtimeRefinements: [organizationProvisioningContainerKeyringRefinement],
});

export const commitOrganizationGroupPolicyOperation = defineJsonOperation({
  auth: "session",
  body: CommitOrganizationGroupPolicyRequestSchema,
  failureResponses: {
    400: PrincipalPolicyErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: PrincipalPolicyErrorResponseSchema,
    404: PrincipalPolicyErrorResponseSchema,
    409: PrincipalPolicyErrorResponseSchema,
    500: ErrorResponseSchema,
    503: PrincipalPolicyErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "organizations.groups.policy.commit",
  method: "PUT",
  params: OrganizationGroupPolicyPathParamsSchema,
  path: "/organizations/{organizationId}/groups/{groupId}/policy-commit",
  responses: {
    200: CommitOrganizationGroupPolicyResponseSchema,
  },
  runtimeRefinements: [organizationProvisioningContainerKeyringRefinement],
});

export const isCommitOrganizationGroupPolicyOperationRequest =
  isCommitOrganizationGroupPolicyRequest;
export const isCommitOrganizationGroupPolicyOperationResponse =
  isCommitOrganizationGroupPolicyResponse;

export const isGetPrincipalPolicyOperationResponse =
  isPrincipalPolicyBundleResponse;
export const isPutPrincipalPolicyOperationRequest =
  isOrganizationPrincipalPolicyRequest;
export const isPutPrincipalPolicyOperationResponse =
  isPrincipalPolicyMutationResponse;
