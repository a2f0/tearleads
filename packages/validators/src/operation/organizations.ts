import { z } from "zod";
import { documentSyncRequestRuntimeRefinements } from "../documentSyncRefinements";
import { organizationDataUsageResponseRuntimeRefinements } from "../organizationDataUsageRefinements";
import {
  organizationProvisioningContainerKeyringRefinement,
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
  CreateOrganizationResponseSchema,
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
  OrganizationPresentationFailureResponseSchema,
  OrganizationProfileResponseSchema,
  OrganizationReadModelFailureResponseSchema,
  OrganizationReadModelResponseSchema,
  PaymentRequiredErrorResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  PrincipalHistoryPreparationFailureResponseSchema,
  PrincipalHistoryPreparationResponseSchema,
  principalHistoryRollbackRefinement,
} from "../response/principalHistoryPreparation";
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
  summary: "Create an organization",
  description:
    "Provisions an additional organization for the signed-in user, who becomes its founding administrator: reserved `Admins` and `Members` groups, root container, signed policies, and metadata documents in one transaction. It also creates the replacement for the caller's purged personal organization, which must use a fresh organization id.",
  method: "POST",
  params: CreateOrganizationPathParamsSchema,
  path: "/organizations",
  responses: {
    200: CreateOrganizationResponseSchema,
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
    403: OrganizationPresentationFailureResponseSchema,
    404: OrganizationPresentationFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "organizations.dataUsage.get",
  summary: "Get organization data usage",
  description:
    "Returns how many bytes of documents and blobs an organization stores, broken down by document category. Any organization member may call it.",
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
    400: OrganizationReadModelFailureResponseSchema,
    401: SessionFailureResponseSchema,
    403: OrganizationPresentationFailureResponseSchema,
    404: OrganizationPresentationFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "organizations.readModel.get",
  summary: "Reconcile the organization read model",
  description:
    "Returns the organization read model: display and navigation data for the directory, groups, group memberships, grants, and organization policy. Without a cursor it returns an atomic snapshot; with one, only lanes changed since. Any organization member may call it; the read model is not authority, so clients still verify signed policies and manifests.",
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
    503: PrincipalHistoryPreparationFailureResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "organizations.groups.create",
  summary: "Create an organization group and advance its signed directory",
  description:
    "Creates a group with its initial signed principal policy and, in the same transaction, the organization policy successor that adds it to the signed group directory. Only organization administrators may call it. A 202 asks for the identical request to be retried after preparation; a 503 with `committed: false` and code `principal_history_preparation_unavailable` proves nothing was written.",
  method: "POST",
  params: OrganizationPathParamsSchema,
  path: "/organizations/{organizationId}/groups",
  responseDescriptions: {
    202: "The attempted operation rolled back. Retry the identical request to continue verification preparation.",
  },
  responses: {
    202: PrincipalHistoryPreparationResponseSchema,
    200: CreateOrganizationGroupResponseSchema,
  },
  runtimeRefinements: [
    organizationProvisioningContainerKeyringRefinement,
    principalHistoryRollbackRefinement,
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
    503: PrincipalHistoryPreparationFailureResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "organizations.groups.delete",
  summary: "Delete an organization group",
  description:
    "Deletes a group through a signed organization policy successor that drops it from the directory, leaving a tombstone so its id can never be reused. Only organization administrators may call it. A 202 asks for the identical request to be retried after preparation; a 503 with `committed: false` proves nothing was written.",
  method: "DELETE",
  params: OrganizationGroupPathParamsSchema,
  path: "/organizations/{organizationId}/groups/{groupId}",
  responseDescriptions: {
    202: "The attempted operation rolled back. Retry the identical request to continue verification preparation.",
  },
  responses: {
    202: PrincipalHistoryPreparationResponseSchema,
    200: DeleteOrganizationGroupResponseSchema,
  },
  runtimeRefinements: [
    organizationProvisioningContainerKeyringRefinement,
    principalHistoryRollbackRefinement,
  ],
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
  summary: "List organization group members",
  description:
    "Lists the members of an organization group from its current signed policy. Any organization member may call it.",
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
  summary: "Update the organization profile",
  description:
    "Binds, or clears, the organization's encrypted profile document, which holds profile fields such as its name that the server cannot read. Only organization administrators may call it.",
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
  summary: "Bind an encrypted roster profile document",
  description:
    "Binds a member's encrypted roster profile document to their organization roster entry. Members may bind their own profile; binding another member's requires organization administrator access.",
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
