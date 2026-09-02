import { expect, test } from "bun:test";
import { organizationDataUsageResponseRuntimeRefinements } from "../organizationDataUsageRefinements";
import {
  organizationProvisioningContainerKeyringRefinement,
  organizationProvisioningGroupNameRefinement,
} from "../organizationProvisioningRefinements";
import { organizationReadModelResponseRuntimeRefinements } from "../organizationReadModelRefinements";
import {
  CreateOrganizationGroupWithPolicyRequestSchema,
  DeleteOrganizationGroupRequestSchema,
  OrganizationProvisioningRequestSchema,
  OrganizationReadModelQuerySchema,
  UpdateOrganizationProfileRequestSchema,
  UpdateOrganizationRosterEntryRequestSchema,
} from "../request";
import {
  CreateOrganizationGroupResponseSchema,
  DeleteOrganizationGroupResponseSchema,
  ErrorResponseSchema,
  OrganizationDataUsageResponseSchema,
  OrganizationDirectoryUserResponseSchema,
  OrganizationGroupMembersResponseSchema,
  OrganizationProfileResponseSchema,
  OrganizationProvisioningResponseSchema,
  OrganizationReadModelResponseSchema,
  PaymentRequiredErrorResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  operationRequestPath,
  operationRequestPathWithQuery,
  operationRoutePath,
} from "./definition";
import {
  createOrganizationGroupOperation,
  createOrganizationOperation,
  deleteOrganizationGroupOperation,
  getOrganizationDataUsageOperation,
  getOrganizationReadModelOperation,
  listOrganizationGroupMembersOperation,
  OrganizationGroupPathParamsSchema,
  OrganizationPathParamsSchema,
  OrganizationRosterPathParamsSchema,
  updateOrganizationProfileOperation,
  updateOrganizationRosterEntryOperation,
} from "./organizations";

const groupId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "33333333-3333-4333-8333-333333333333";

test("create organization operation owns its HTTP contract metadata", () => {
  expect(createOrganizationOperation).toMatchObject({
    auth: "session",
    body: OrganizationProvisioningRequestSchema,
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    id: "organizations.create",
    method: "POST",
    path: "/organizations",
    responses: { 200: OrganizationProvisioningResponseSchema },
  });
  expect(createOrganizationOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
});

test("create organization paths are shared without parameters", () => {
  expect(operationRoutePath(createOrganizationOperation)).toBe(
    "/organizations",
  );
  expect(operationRequestPath(createOrganizationOperation, {})).toBe(
    "/organizations",
  );
});

test("get organization data usage operation owns its HTTP contract metadata", () => {
  expect(getOrganizationDataUsageOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 500],
    id: "organizations.dataUsage.get",
    method: "GET",
    params: OrganizationPathParamsSchema,
    path: "/organizations/{organizationId}/data-usage",
    responses: { 200: OrganizationDataUsageResponseSchema },
    runtimeRefinements: organizationDataUsageResponseRuntimeRefinements,
  });
  expect(getOrganizationDataUsageOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  });
});

test("get organization data usage paths derive from the shared operation", () => {
  expect(operationRoutePath(getOrganizationDataUsageOperation)).toBe(
    "/organizations/:organizationId/data-usage",
  );
  expect(
    operationRequestPath(getOrganizationDataUsageOperation, {
      organizationId,
    }),
  ).toBe(`/organizations/${organizationId}/data-usage`);
  expect(() =>
    operationRequestPath(getOrganizationDataUsageOperation, {
      organizationId: "invalid",
    }),
  ).toThrow("Invalid path parameters for organizations.dataUsage.get");
});

test("organization read-model operation owns its HTTP contract", () => {
  expect(getOrganizationReadModelOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 500],
    id: "organizations.readModel.get",
    method: "GET",
    params: OrganizationPathParamsSchema,
    query: OrganizationReadModelQuerySchema,
    responses: { 200: OrganizationReadModelResponseSchema },
    runtimeRefinements: organizationReadModelResponseRuntimeRefinements,
  });
  expect(getOrganizationReadModelOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  });
});

test("organization read-model paths derive from shared path and query schemas", () => {
  expect(operationRoutePath(getOrganizationReadModelOperation)).toBe(
    "/organizations/:organizationId/read-model",
  );
  expect(
    operationRequestPathWithQuery(
      getOrganizationReadModelOperation,
      { organizationId },
      { cursor: "opaque+/=cursor" },
    ),
  ).toBe(
    `/organizations/${organizationId}/read-model?cursor=opaque%2B%2F%3Dcursor`,
  );
  expect(
    operationRequestPathWithQuery(
      getOrganizationReadModelOperation,
      { organizationId },
      {},
    ),
  ).toBe(`/organizations/${organizationId}/read-model`);
  expect(
    operationRequestPathWithQuery(
      getOrganizationReadModelOperation,
      { organizationId },
      { cursor: "" },
    ),
  ).toBe(`/organizations/${organizationId}/read-model?cursor=`);
  expect(() =>
    operationRequestPathWithQuery(
      getOrganizationReadModelOperation,
      { organizationId: "invalid" },
      {},
    ),
  ).toThrow("Invalid path parameters for organizations.readModel.get");
  expect(() =>
    operationRequestPathWithQuery(
      getOrganizationReadModelOperation,
      { organizationId },
      { cursor: 1 } as never,
    ),
  ).toThrow("Invalid query parameters for organizations.readModel.get");
});

test("organization management operations own their HTTP contracts", () => {
  expect(createOrganizationGroupOperation).toMatchObject({
    auth: "session",
    body: CreateOrganizationGroupWithPolicyRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
    id: "organizations.groups.create",
    method: "POST",
    params: OrganizationPathParamsSchema,
    responses: { 200: CreateOrganizationGroupResponseSchema },
    runtimeRefinements: [
      organizationProvisioningContainerKeyringRefinement,
      organizationProvisioningGroupNameRefinement,
    ],
  });
  expect(createOrganizationGroupOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
  expect(deleteOrganizationGroupOperation).toMatchObject({
    auth: "session",
    body: DeleteOrganizationGroupRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
    id: "organizations.groups.delete",
    method: "DELETE",
    params: OrganizationGroupPathParamsSchema,
    responses: { 200: DeleteOrganizationGroupResponseSchema },
    runtimeRefinements: [organizationProvisioningContainerKeyringRefinement],
  });
  expect(deleteOrganizationGroupOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
  expect(listOrganizationGroupMembersOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 500],
    id: "organizations.groups.members.list",
    method: "GET",
    params: OrganizationGroupPathParamsSchema,
    responses: { 200: OrganizationGroupMembersResponseSchema },
  });
  expect(updateOrganizationProfileOperation).toMatchObject({
    auth: "session",
    body: UpdateOrganizationProfileRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 500],
    id: "organizations.profile.update",
    method: "PUT",
    params: OrganizationPathParamsSchema,
    responses: { 200: OrganizationProfileResponseSchema },
  });
  expect(updateOrganizationRosterEntryOperation).toMatchObject({
    auth: "session",
    body: UpdateOrganizationRosterEntryRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 500],
    id: "organizations.roster.update",
    method: "PUT",
    params: OrganizationRosterPathParamsSchema,
    responses: { 200: OrganizationDirectoryUserResponseSchema },
  });
});

test("organization management paths derive from shared operations", () => {
  expect(
    operationRequestPath(createOrganizationGroupOperation, { organizationId }),
  ).toBe(`/organizations/${organizationId}/groups`);
  expect(
    operationRequestPath(deleteOrganizationGroupOperation, {
      groupId,
      organizationId,
    }),
  ).toBe(`/organizations/${organizationId}/groups/${groupId}`);
  expect(
    operationRequestPath(listOrganizationGroupMembersOperation, {
      groupId,
      organizationId,
    }),
  ).toBe(`/organizations/${organizationId}/groups/${groupId}/members`);
  expect(
    operationRequestPath(updateOrganizationProfileOperation, {
      organizationId,
    }),
  ).toBe(`/organizations/${organizationId}/profile`);
  expect(
    operationRequestPath(updateOrganizationRosterEntryOperation, {
      organizationId,
      userId,
    }),
  ).toBe(`/organizations/${organizationId}/roster/${userId}`);
  expect(() =>
    operationRequestPath(deleteOrganizationGroupOperation, {
      groupId: "invalid",
      organizationId,
    }),
  ).toThrow("Invalid path parameters for organizations.groups.delete");
});
