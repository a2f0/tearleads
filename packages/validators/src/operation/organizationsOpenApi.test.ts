import { expect, test } from "bun:test";
import { openApiDocument } from "./openApi";
import {
  createOrganizationOperation,
  getOrganizationDataUsageOperation,
} from "./organizations";

const createOrganizationPost = openApiDocument.paths["/organizations"]?.post;
if (createOrganizationPost?.requestBody === undefined) {
  throw new Error("Create organization OpenAPI request is missing");
}
const requestSchema =
  createOrganizationPost.requestBody.content["application/json"].schema;

test("create organization OpenAPI documents its shared contract", () => {
  expect(createOrganizationPost.operationId).toBe("organizations.create");
  expect(createOrganizationPost.parameters).toEqual([]);
  expect(createOrganizationPost.security).toEqual([{ bearerAuth: [] }]);
  expect(Object.keys(createOrganizationPost.responses)).toEqual([
    "200",
    "400",
    "401",
    "403",
    "404",
    "409",
    "500",
    "503",
  ]);
  expect(requestSchema.required).toContain("initialRootContainer");
  expect(requestSchema.required).toContain("initialRootMetadataDocument");
  expect(createOrganizationPost["x-tearleads-runtime-refinements"]).toEqual(
    createOrganizationOperation.runtimeRefinements,
  );
});

test("organization data usage OpenAPI documents its shared contract", () => {
  const operation =
    openApiDocument.paths["/organizations/{organizationId}/data-usage"]?.get;
  if (operation === undefined) {
    throw new Error("Organization data usage OpenAPI operation is missing");
  }

  expect(operation.operationId).toBe("organizations.dataUsage.get");
  expect(operation.parameters).toHaveLength(1);
  expect(operation.parameters[0]).toMatchObject({
    in: "path",
    name: "organizationId",
    required: true,
  });
  expect(operation.security).toEqual([{ bearerAuth: [] }]);
  expect(Object.keys(operation.responses)).toEqual([
    "200",
    "400",
    "401",
    "403",
    "404",
    "500",
  ]);
  expect(operation["x-tearleads-runtime-refinements"]).toEqual(
    getOrganizationDataUsageOperation.runtimeRefinements,
  );
});
