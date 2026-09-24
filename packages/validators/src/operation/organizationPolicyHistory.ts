import { z } from "zod";
import {
  ErrorResponseSchema,
  OrganizationPolicyHistoryResponseSchema,
  OrganizationPresentationFailureResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { nonEmptyStringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { OrganizationPathParamsSchema } from "./organizations";

export const getOrganizationPolicyHistoryOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: OrganizationPresentationFailureResponseSchema,
    404: OrganizationPresentationFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "organizations.policyHistory.get",
  method: "GET",
  params: OrganizationPathParamsSchema,
  path: "/organizations/{organizationId}/policy-history",
  query: z.strictObject({ stateHash: nonEmptyStringSchema }),
  responses: { 200: OrganizationPolicyHistoryResponseSchema },
});
