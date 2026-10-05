import { z } from "zod";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  CommitOrganizationGroupPolicyRequestSchema,
  isCommitOrganizationGroupPolicyRequest,
  isOrganizationPrincipalPolicyRequest,
  OrganizationPrincipalPolicyRequestSchema,
} from "../request";
import {
  CommitOrganizationGroupPolicyConflictResponseSchema,
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
import { PrincipalHistoryPreparationResponseSchema } from "../response/principalHistoryPreparation";
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

const preparationResponseDescriptions = {
  202: "The attempted operation rolled back. Retry the identical request to continue verification preparation.",
} as const;

export const getPrincipalPolicyOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    409: PrincipalPolicyErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 409, 500],
  id: "principals.policy.get",
  method: "GET",
  params: PrincipalPolicyPathParamsSchema,
  path: "/principals/{principalType}/{principalId}/policy",
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: PrincipalPolicyBundleResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
});

export const putPrincipalPolicyOperation = defineJsonOperation({
  auth: "session",
  body: OrganizationPrincipalPolicyRequestSchema,
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
  id: "principals.policy.update",
  method: "PUT",
  params: PrincipalPolicyPathParamsSchema,
  path: "/principals/{principalType}/{principalId}/policy",
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: PrincipalPolicyMutationResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
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
    409: CommitOrganizationGroupPolicyConflictResponseSchema,
    500: ErrorResponseSchema,
    503: PrincipalPolicyErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "organizations.groups.policy.commit",
  method: "PUT",
  params: OrganizationGroupPolicyPathParamsSchema,
  path: "/organizations/{organizationId}/groups/{groupId}/policy-commit",
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: CommitOrganizationGroupPolicyResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
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
