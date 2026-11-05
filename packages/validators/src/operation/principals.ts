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
  isPrincipalPolicyMutationResponse,
  PaymentRequiredErrorResponseSchema,
  PrincipalPolicyErrorResponseSchema,
  PrincipalPolicyMutationResponseSchema,
  type PrincipalPolicyReadResponse,
  PrincipalPolicyReadResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  PrincipalHistoryPreparationFailureResponseSchema,
  PrincipalHistoryPreparationResponseSchema,
  principalHistoryRollbackRefinement,
} from "../response/principalHistoryPreparation";
import { uuidV4StringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { PrincipalPolicyPageQuerySchema } from "./principalPolicyPageQuery";

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
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 409, 500],
  id: "principals.policy.get",
  summary: "Get a principal policy bundle",
  description:
    "Returns a page of a group or organization's signed principal policy chain with its current member envelopes, so the client can verify the chain and a member can unwrap the principal's key; a conditional read that names the still-current head gets a short unchanged reply instead. It is served only to callers who depend on it: active roster members, members of the principal, or holders of a grant whose path cites it. A 202 asks the client to retry the identical request after policy history is prepared.",
  method: "GET",
  params: PrincipalPolicyPathParamsSchema,
  path: "/principals/{principalType}/{principalId}/policy",
  query: PrincipalPolicyPageQuerySchema,
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: PrincipalPolicyReadResponseSchema,
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
    503: PrincipalHistoryPreparationFailureResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "principals.policy.update",
  summary: "Update a principal policy",
  description:
    "Commits the organization's next signed principal policy and its member envelopes atomically; group policies change through the group policy commit route instead. It requires organization administrator authority, and a stale head returns 409. A 202 asks for the identical request to be retried after preparation, and only a 503 with `committed: false` and code `principal_history_preparation_unavailable` proves nothing was written.",
  method: "PUT",
  params: PrincipalPolicyPathParamsSchema,
  path: "/principals/{principalType}/{principalId}/policy",
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: PrincipalPolicyMutationResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [
    organizationProvisioningContainerKeyringRefinement,
    principalHistoryRollbackRefinement,
  ],
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
    503: PrincipalHistoryPreparationFailureResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "organizations.groups.policy.commit",
  summary: "Advance a group policy and its signed directory head",
  description:
    "Commits a group's next signed principal policy, its member envelopes, the matching organization policy successor, and the container grant updates the change requires, all in one transaction. Only organization administrators may call it; a stale head returns 409. A 202 asks for the identical request to be retried after preparation, and only a 503 with `committed: false` and code `principal_history_preparation_unavailable` proves nothing was written.",
  method: "PUT",
  params: OrganizationGroupPolicyPathParamsSchema,
  path: "/organizations/{organizationId}/groups/{groupId}/policy-commit",
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: CommitOrganizationGroupPolicyResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [
    organizationProvisioningContainerKeyringRefinement,
    principalHistoryRollbackRefinement,
  ],
});

export const isCommitOrganizationGroupPolicyOperationRequest =
  isCommitOrganizationGroupPolicyRequest;
export const isCommitOrganizationGroupPolicyOperationResponse =
  isCommitOrganizationGroupPolicyResponse;

export function isGetPrincipalPolicyOperationResponse(
  value: unknown,
): value is PrincipalPolicyReadResponse {
  return PrincipalPolicyReadResponseSchema.safeParse(value).success;
}
export const isPutPrincipalPolicyOperationRequest =
  isOrganizationPrincipalPolicyRequest;
export const isPutPrincipalPolicyOperationResponse =
  isPrincipalPolicyMutationResponse;
