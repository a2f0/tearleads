import { expect, test } from "bun:test";
import { openApiDocument } from "./openApi";
import {
  createOrganizationGroupOperation,
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

test("organization management OpenAPI documents shared contracts", () => {
  const createGroup =
    openApiDocument.paths["/organizations/{organizationId}/groups"]?.post;
  const deleteGroup =
    openApiDocument.paths["/organizations/{organizationId}/groups/{groupId}"]
      ?.delete;
  const groupMembers =
    openApiDocument.paths[
      "/organizations/{organizationId}/groups/{groupId}/members"
    ]?.get;
  const updateProfile =
    openApiDocument.paths["/organizations/{organizationId}/profile"]?.put;
  const updateRoster =
    openApiDocument.paths["/organizations/{organizationId}/roster/{userId}"]
      ?.put;
  if (
    createGroup?.requestBody === undefined ||
    deleteGroup === undefined ||
    groupMembers === undefined ||
    updateProfile?.requestBody === undefined ||
    updateRoster?.requestBody === undefined
  ) {
    throw new Error("Organization management OpenAPI operations are missing");
  }

  expect(createGroup.operationId).toBe("organizations.groups.create");
  expect(Object.keys(createGroup.responses)).toEqual([
    "200",
    "400",
    "401",
    "402",
    "403",
    "404",
    "409",
    "500",
    "503",
  ]);
  expect(
    createGroup.requestBody.content["application/json"].schema.required,
  ).toEqual(["groupId", "initialGroupPolicy", "name"]);
  expect(createGroup["x-tearleads-runtime-refinements"]).toEqual(
    createOrganizationGroupOperation.runtimeRefinements,
  );
  expect(deleteGroup.operationId).toBe("organizations.groups.delete");
  expect(deleteGroup.parameters[0]).toMatchObject({ name: "organizationId" });
  expect(deleteGroup.parameters[1]).toMatchObject({ name: "groupId" });
  expect(groupMembers.operationId).toBe("organizations.groups.members.list");
  expect(updateProfile.operationId).toBe("organizations.profile.update");
  expect(
    updateProfile.requestBody.content["application/json"].schema.required,
  ).toEqual(["profileDocumentId"]);
  expect(updateRoster.operationId).toBe("organizations.roster.update");
  expect(updateRoster.parameters[0]).toMatchObject({ name: "organizationId" });
  expect(updateRoster.parameters[1]).toMatchObject({ name: "userId" });
  for (const operation of [
    createGroup,
    deleteGroup,
    groupMembers,
    updateProfile,
    updateRoster,
  ]) {
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  }
});
