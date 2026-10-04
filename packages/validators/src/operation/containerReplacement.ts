import { z } from "zod";
import { ErrorResponseSchema, SessionFailureResponseSchema } from "../response";
import { OrganizationReplacementAuthorizationSchema } from "../util";
import { defineJsonOperation } from "./definition";

export const ContainerReplacementAuthorizationsResponseSchema = z.object({
  authorizations: z.array(OrganizationReplacementAuthorizationSchema),
});
export type ContainerReplacementAuthorizationsResponse = z.infer<
  typeof ContainerReplacementAuthorizationsResponseSchema
>;
export function isContainerReplacementAuthorizationsResponse(
  value: unknown,
): value is ContainerReplacementAuthorizationsResponse {
  return ContainerReplacementAuthorizationsResponseSchema.safeParse(value)
    .success;
}
export const getContainerReplacementAuthorizationsOperation =
  defineJsonOperation({
    auth: "session",
    failureResponses: {
      400: ErrorResponseSchema,
      401: SessionFailureResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "containers.replacementAuthorizations.get",
    method: "GET",
    params: z.strictObject({
      containerId: z.string(),
      replacesOrganizationId: z.string(),
    }),
    path: "/containers/{containerId}/replacement-authorizations/{replacesOrganizationId}",
    responses: { 200: ContainerReplacementAuthorizationsResponseSchema },
  });
