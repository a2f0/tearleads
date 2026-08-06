import { expect, test } from "bun:test";
import { organizationDataUsageResponseRuntimeRefinements } from "../organizationDataUsageRefinements";
import { OrganizationProvisioningRequestSchema } from "../request";
import {
  ErrorResponseSchema,
  OrganizationDataUsageResponseSchema,
  OrganizationProvisioningResponseSchema,
} from "../response";
import { operationRequestPath, operationRoutePath } from "./definition";
import {
  createOrganizationOperation,
  getOrganizationDataUsageOperation,
  OrganizationPathParamsSchema,
} from "./organizations";

const organizationId = "11111111-1111-4111-8111-111111111111";

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
