import { z } from "zod";
import { ErrorResponseSchema, SessionFailureResponseSchema } from "../response";
import { PrincipalHistoryPreparationResponseSchema } from "../response/principalHistoryPreparation";
import { PrincipalPolicySnapshotPageResponseSchema } from "../response/principalPolicySnapshotPage";
import { boundedNonEmptyStringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { PrincipalPolicyPageQuerySchema } from "./principalPolicyPageQuery";

export const ProjectionPolicyHistoryQuerySchema = z.strictObject({
  grant: boundedNonEmptyStringSchema(4096),
  afterVersion: PrincipalPolicyPageQuerySchema.shape.afterVersion,
});

export type ProjectionPolicyHistoryQuery = z.infer<
  typeof ProjectionPolicyHistoryQuerySchema
>;

export const getProjectionPolicyHistoryOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 503],
  id: "principals.history.get",
  method: "GET",
  params: z.strictObject({}),
  path: "/principals/history",
  query: ProjectionPolicyHistoryQuerySchema,
  responseDescriptions: {
    202: "Verification preparation is pending. Retry the identical authorized read.",
  },
  responses: {
    200: PrincipalPolicySnapshotPageResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
});
