import { z } from "zod";
import { ErrorResponseSchema, SessionFailureResponseSchema } from "../response";
import { PrincipalHistoryPreparationResponseSchema } from "../response/principalHistoryPreparation";
import { PrincipalPolicySnapshotPageResponseSchema } from "../response/principalPolicySnapshotPage";
import { boundedNonEmptyStringSchema, sha256HexStringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { PrincipalPolicyPageQuerySchema } from "./principalPolicyPageQuery";

/**
 * `knownStateHash` names a signed head state the client already holds. When
 * it equals the grant's head, each page answers `currentState: null` and the
 * client verifies its own copy instead.
 */
export const ProjectionPolicyHistoryQuerySchema = z.strictObject({
  grant: boundedNonEmptyStringSchema(4096),
  afterVersion: PrincipalPolicyPageQuerySchema.shape.afterVersion,
  knownStateHash: sha256HexStringSchema.optional(),
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
  summary: "Page projection policy history",
  description:
    "Pages public signed policy snapshots, up to 32 predecessor states at a time, for a principal head cited by an object the caller can read. The opaque `grant` query value names that object and head, and every page rechecks current access to it. A `knownStateHash` equal to that head's state hash makes every page answer `currentState: null`; the client then verifies the signed copy it holds. A 202 asks the client to retry the identical request after policy history is prepared.",
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
