import { z } from "zod";
import { documentSyncRequestRuntimeRefinements } from "../documentSyncRefinements";
import { organizationDataUsageResponseRuntimeRefinements } from "../organizationDataUsageRefinements";
import {
  organizationProvisioningRequestRuntimeRefinements,
  organizationProvisioningResponseRuntimeRefinements,
} from "../organizationProvisioningRefinements";
import {
  isCreateOrganizationRequest,
  OrganizationProvisioningRequestSchema,
} from "../request";
import {
  ErrorResponseSchema,
  isCreateOrganizationResponse,
  isOrganizationDataUsageResponse,
  OrganizationDataUsageResponseSchema,
  OrganizationProvisioningResponseSchema,
} from "../response";
import { uuidV4StringSchema } from "../schema";
import { defineJsonOperation } from "./definition";

const CreateOrganizationPathParamsSchema = z.strictObject({});
export const OrganizationPathParamsSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
});

export type OrganizationPathParams = z.infer<
  typeof OrganizationPathParamsSchema
>;

export const createOrganizationOperation = defineJsonOperation({
  auth: "session",
  body: OrganizationProvisioningRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500, 503],
  id: "organizations.create",
  method: "POST",
  params: CreateOrganizationPathParamsSchema,
  path: "/organizations",
  responses: {
    200: OrganizationProvisioningResponseSchema,
  },
  runtimeRefinements: [
    ...documentSyncRequestRuntimeRefinements,
    ...organizationProvisioningRequestRuntimeRefinements,
    ...organizationProvisioningResponseRuntimeRefinements,
  ],
});

export const getOrganizationDataUsageOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "organizations.dataUsage.get",
  method: "GET",
  params: OrganizationPathParamsSchema,
  path: "/organizations/{organizationId}/data-usage",
  responses: {
    200: OrganizationDataUsageResponseSchema,
  },
  runtimeRefinements: organizationDataUsageResponseRuntimeRefinements,
});

export const isCreateOrganizationOperationRequest = isCreateOrganizationRequest;
export const isCreateOrganizationOperationResponse =
  isCreateOrganizationResponse;
export const isGetOrganizationDataUsageOperationResponse =
  isOrganizationDataUsageResponse;
