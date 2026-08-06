import { expect, test } from "bun:test";
import { openApiDocument } from "./openApi";
import { createOrganizationOperation } from "./organizations";

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
