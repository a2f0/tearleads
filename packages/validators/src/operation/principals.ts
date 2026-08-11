import { z } from "zod";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  isPutPrincipalPolicyRequest,
  PutPrincipalPolicyRequestSchema,
} from "../request";
import {
  ErrorResponseSchema,
  isPrincipalPolicyBundleResponse,
  isPrincipalPolicyMutationResponse,
  PrincipalPolicyBundleResponseSchema,
  PrincipalPolicyErrorResponseSchema,
  PrincipalPolicyMutationResponseSchema,
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

export const getPrincipalPolicyOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: PrincipalPolicyErrorResponseSchema,
    401: ErrorResponseSchema,
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
  body: PutPrincipalPolicyRequestSchema,
  failureResponses: {
    400: PrincipalPolicyErrorResponseSchema,
    401: ErrorResponseSchema,
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

export const isGetPrincipalPolicyOperationResponse =
  isPrincipalPolicyBundleResponse;
export const isPutPrincipalPolicyOperationRequest = isPutPrincipalPolicyRequest;
export const isPutPrincipalPolicyOperationResponse =
  isPrincipalPolicyMutationResponse;
