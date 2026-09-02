import { z } from "zod";
import { documentSyncRequestRuntimeRefinements } from "../documentSyncRefinements";
import { organizationDataUsageResponseRuntimeRefinements } from "../organizationDataUsageRefinements";
import {
  organizationProvisioningContainerKeyringRefinement,
  organizationProvisioningGroupNameRefinement,
  organizationProvisioningRequestRuntimeRefinements,
  organizationProvisioningResponseRuntimeRefinements,
} from "../organizationProvisioningRefinements";
import { organizationReadModelResponseRuntimeRefinements } from "../organizationReadModelRefinements";
import {
  CreateOrganizationGroupWithPolicyRequestSchema,
  CreateOrganizationRequestSchema,
  DeleteOrganizationGroupRequestSchema,
  isCreateOrganizationGroupWithPolicyRequest,
  isCreateOrganizationRequest,
  isUpdateOrganizationProfileRequest,
  isUpdateOrganizationRosterEntryRequest,
  OrganizationReadModelQuerySchema,
  UpdateOrganizationProfileRequestSchema,
  UpdateOrganizationRosterEntryRequestSchema,
} from "../request";
import {
  CreateOrganizationGroupResponseSchema,
  DeleteOrganizationGroupResponseSchema,
  ErrorResponseSchema,
  isCreateOrganizationGroupResponse,
  isCreateOrganizationResponse,
  isDeleteOrganizationGroupResponse,
  isOrganizationDataUsageResponse,
  isOrganizationDirectoryUserResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationProfileResponse,
  isOrganizationReadModelResponse,
  OrganizationDataUsageResponseSchema,
  OrganizationDirectoryUserResponseSchema,
  OrganizationGroupMembersResponseSchema,
  OrganizationProfileResponseSchema,
  OrganizationProvisioningResponseSchema,
  OrganizationReadModelResponseSchema,
  PaymentRequiredErrorResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { uuidV4StringSchema } from "../schema";
import { defineJsonOperation } from "./definition";

const CreateOrganizationPathParamsSchema = z.strictObject({});
export const OrganizationPathParamsSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
});
export const OrganizationGroupPathParamsSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
  groupId: uuidV4StringSchema,
});
export const OrganizationRosterPathParamsSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
  userId: uuidV4StringSchema,
});

export type OrganizationPathParams = z.infer<
  typeof OrganizationPathParamsSchema
>;
export type OrganizationGroupPathParams = z.infer<
  typeof OrganizationGroupPathParamsSchema
>;
export type OrganizationRosterPathParams = z.infer<
  typeof OrganizationRosterPathParamsSchema
>;

export const createOrganizationOperation = defineJsonOperation({
  auth: "session",
  body: CreateOrganizationRequestSchema,
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
    401: SessionFailureResponseSchema,
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

export const getOrganizationReadModelOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "organizations.readModel.get",
  method: "GET",
  params: OrganizationPathParamsSchema,
  path: "/organizations/{organizationId}/read-model",
  query: OrganizationReadModelQuerySchema,
  responses: {
    200: OrganizationReadModelResponseSchema,
  },
  runtimeRefinements: organizationReadModelResponseRuntimeRefinements,
});

export const createOrganizationGroupOperation = defineJsonOperation({
  auth: "session",
  body: CreateOrganizationGroupWithPolicyRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "organizations.groups.create",
  method: "POST",
  params: OrganizationPathParamsSchema,
  path: "/organizations/{organizationId}/groups",
  responses: {
    200: CreateOrganizationGroupResponseSchema,
  },
  runtimeRefinements: [
    organizationProvisioningContainerKeyringRefinement,
    organizationProvisioningGroupNameRefinement,
  ],
});

export const deleteOrganizationGroupOperation = defineJsonOperation({
  auth: "session",
  body: DeleteOrganizationGroupRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "organizations.groups.delete",
  method: "DELETE",
  params: OrganizationGroupPathParamsSchema,
  path: "/organizations/{organizationId}/groups/{groupId}",
  responses: {
    200: DeleteOrganizationGroupResponseSchema,
  },
  runtimeRefinements: [organizationProvisioningContainerKeyringRefinement],
});

export const listOrganizationGroupMembersOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "organizations.groups.members.list",
  method: "GET",
  params: OrganizationGroupPathParamsSchema,
  path: "/organizations/{organizationId}/groups/{groupId}/members",
  responses: {
    200: OrganizationGroupMembersResponseSchema,
  },
});

export const updateOrganizationProfileOperation = defineJsonOperation({
  auth: "session",
  body: UpdateOrganizationProfileRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 500],
  id: "organizations.profile.update",
  method: "PUT",
  params: OrganizationPathParamsSchema,
  path: "/organizations/{organizationId}/profile",
  responses: {
    200: OrganizationProfileResponseSchema,
  },
});

export const updateOrganizationRosterEntryOperation = defineJsonOperation({
  auth: "session",
  body: UpdateOrganizationRosterEntryRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 500],
  id: "organizations.roster.update",
  method: "PUT",
  params: OrganizationRosterPathParamsSchema,
  path: "/organizations/{organizationId}/roster/{userId}",
  responses: {
    200: OrganizationDirectoryUserResponseSchema,
  },
});

export const isCreateOrganizationGroupOperationRequest =
  isCreateOrganizationGroupWithPolicyRequest;
export const isCreateOrganizationGroupOperationResponse =
  isCreateOrganizationGroupResponse;
export const isCreateOrganizationOperationRequest = isCreateOrganizationRequest;
export const isCreateOrganizationOperationResponse =
  isCreateOrganizationResponse;
export const isDeleteOrganizationGroupOperationResponse =
  isDeleteOrganizationGroupResponse;
export const isGetOrganizationDataUsageOperationResponse =
  isOrganizationDataUsageResponse;
export const isGetOrganizationReadModelOperationResponse =
  isOrganizationReadModelResponse;
export const isListOrganizationGroupMembersOperationResponse =
  isOrganizationGroupMembersResponse;
export const isUpdateOrganizationProfileOperationRequest =
  isUpdateOrganizationProfileRequest;
export const isUpdateOrganizationProfileOperationResponse =
  isOrganizationProfileResponse;
export const isUpdateOrganizationRosterEntryOperationRequest =
  isUpdateOrganizationRosterEntryRequest;
export const isUpdateOrganizationRosterEntryOperationResponse =
  isOrganizationDirectoryUserResponse;
