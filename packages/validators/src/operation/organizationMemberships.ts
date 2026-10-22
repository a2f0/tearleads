import { z } from "zod";
import {
  isUpdateOrganizationMembershipRequest,
  UpdateOrganizationMembershipRequestSchema,
} from "../request";
import {
  ErrorResponseSchema,
  isOrganizationMembershipResponse,
  isOrganizationMembershipsResponse,
  OrganizationMembershipResponseSchema,
  OrganizationMembershipsResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { uuidV4StringSchema } from "../schema";
import {
  isOrganizationLeaveRequest,
  OrganizationLeaveRequestSchema,
} from "../util/organizationLeaveRequest";
import { defineJsonOperation } from "./definition";

/**
 * The session user's conduit to the organizations they belong to: one row per
 * active roster entry, carrying the user's own choices. Each operation reads or
 * writes only the session user's rows, so it needs no organization role.
 */
export const OrganizationMembershipPathParamsSchema = z.strictObject({
  organizationId: uuidV4StringSchema,
});

export type OrganizationMembershipPathParams = z.infer<
  typeof OrganizationMembershipPathParamsSchema
>;

export const listOrganizationMembershipsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: SessionFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "organizationMemberships.list",
  method: "GET",
  params: z.strictObject({}),
  path: "/organization-memberships",
  responses: {
    200: OrganizationMembershipsResponseSchema,
  },
});

export const updateOrganizationMembershipOperation = defineJsonOperation({
  auth: "session",
  body: UpdateOrganizationMembershipRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 404, 409, 500],
  id: "organizationMemberships.update",
  method: "PUT",
  params: OrganizationMembershipPathParamsSchema,
  path: "/organization-memberships/{organizationId}",
  responses: {
    200: OrganizationMembershipResponseSchema,
  },
});

/**
 * Files the session user's signed request to leave one organization. It is a
 * request, not a removal: an administrator acts on it by signing the member's
 * removal, which clears it.
 */
export const requestOrganizationLeaveOperation = defineJsonOperation({
  auth: "session",
  body: OrganizationLeaveRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 404, 409, 500],
  id: "organizationMemberships.leaveRequest.put",
  method: "PUT",
  params: OrganizationMembershipPathParamsSchema,
  path: "/organization-memberships/{organizationId}/leave-request",
  responses: {
    200: OrganizationMembershipResponseSchema,
  },
});

export const withdrawOrganizationLeaveRequestOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: SessionFailureResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 404, 500],
  id: "organizationMemberships.leaveRequest.delete",
  method: "DELETE",
  params: OrganizationMembershipPathParamsSchema,
  path: "/organization-memberships/{organizationId}/leave-request",
  responses: {
    200: OrganizationMembershipResponseSchema,
  },
});

export const isRequestOrganizationLeaveOperationRequest =
  isOrganizationLeaveRequest;
export const isListOrganizationMembershipsOperationResponse =
  isOrganizationMembershipsResponse;
export const isUpdateOrganizationMembershipOperationRequest =
  isUpdateOrganizationMembershipRequest;
export const isUpdateOrganizationMembershipOperationResponse =
  isOrganizationMembershipResponse;
