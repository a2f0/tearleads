import { expect, test } from "bun:test";
import { OrganizationProvisioningRequestSchema } from "../request";
import {
  ErrorResponseSchema,
  OrganizationProvisioningResponseSchema,
} from "../response";
import { operationRequestPath, operationRoutePath } from "./definition";
import { createOrganizationOperation } from "./organizations";

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
