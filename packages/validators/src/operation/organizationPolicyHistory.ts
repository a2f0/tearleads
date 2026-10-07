import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  ErrorResponseSchema,
  OrganizationPolicyHistoryResponseSchema,
  OrganizationPresentationFailureResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  PrincipalHistoryPreparationFailureResponseSchema,
  PrincipalHistoryPreparationResponseSchema,
  principalHistoryRollbackRefinement,
} from "../response/principalHistoryPreparation";
import { nonEmptyStringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { OrganizationPathParamsSchema } from "./organizations";
import { PrincipalPolicyPageQuerySchema } from "./principalPolicyPageQuery";

export const getOrganizationPolicyHistoryOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: OrganizationPresentationFailureResponseSchema,
    404: OrganizationPresentationFailureResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: PrincipalHistoryPreparationFailureResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 503],
  id: "organizations.policyHistory.get",
  method: "GET",
  params: OrganizationPathParamsSchema,
  path: "/organizations/{organizationId}/policy-history",
  query: z.strictObject({
    stateHash: nonEmptyStringSchema,
    beforeVersion: registerJsonSchemaFragment(
      PrincipalPolicyPageQuerySchema.shape.afterVersion
        .unwrap()
        .refine((value) => value >= 2),
      { type: "integer", minimum: 2, maximum: Number.MAX_SAFE_INTEGER },
    ).optional(),
  }),
  responses: {
    200: OrganizationPolicyHistoryResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [principalHistoryRollbackRefinement],
});
