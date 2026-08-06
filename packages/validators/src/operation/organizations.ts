import { z } from "zod";
import { documentSyncRequestRuntimeRefinements } from "../documentSyncRefinements";
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
  OrganizationProvisioningResponseSchema,
} from "../response";
import { defineJsonOperation } from "./definition";

const CreateOrganizationPathParamsSchema = z.strictObject({});

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

export const isCreateOrganizationOperationRequest = isCreateOrganizationRequest;
export const isCreateOrganizationOperationResponse =
  isCreateOrganizationResponse;
