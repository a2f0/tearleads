import { expect, test } from "bun:test";
import { organizationDataUsageResponseRuntimeRefinements } from "../organizationDataUsageRefinements";
import { organizationProvisioningGroupNameRefinement } from "../organizationProvisioningRefinements";
import {
  CreateOrganizationGroupRequestSchema,
  OrganizationProvisioningRequestSchema,
  UpdateOrganizationProfileRequestSchema,
  UpdateOrganizationRosterEntryRequestSchema,
} from "../request";
import {
  DeleteOrganizationGroupResponseSchema,
  ErrorResponseSchema,
  OrganizationDataUsageResponseSchema,
  OrganizationDirectoryUserResponseSchema,
  OrganizationGroupMembersResponseSchema,
  OrganizationGroupSummaryResponseSchema,
  OrganizationProfileResponseSchema,
  OrganizationProvisioningResponseSchema,
  PaymentRequiredErrorResponseSchema,
} from "../response";
import { operationRequestPath, operationRoutePath } from "./definition";
import {
  createOrganizationGroupOperation,
  createOrganizationOperation,
  deleteOrganizationGroupOperation,
  getOrganizationDataUsageOperation,
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
    401: ErrorResponseSchema,
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
    401: ErrorResponseSchema,
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

test("organization management operations own their HTTP contracts", () => {
  expect(createOrganizationGroupOperation).toMatchObject({
    auth: "session",
    body: CreateOrganizationGroupRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
    id: "organizations.groups.create",
    method: "POST",
    params: OrganizationPathParamsSchema,
    responses: { 200: OrganizationGroupSummaryResponseSchema },
    runtimeRefinements: [organizationProvisioningGroupNameRefinement],
  });
  expect(createOrganizationGroupOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
  expect(deleteOrganizationGroupOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 402, 403, 404, 409, 500],
    id: "organizations.groups.delete",
    method: "DELETE",
    params: OrganizationGroupPathParamsSchema,
    responses: { 200: DeleteOrganizationGroupResponseSchema },
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
