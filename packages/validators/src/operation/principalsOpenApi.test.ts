import { expect, test } from "bun:test";
import { openApiDocument } from "./openApi";

test("principal policy OpenAPI documents both shared operations", () => {
  const policyPath =
    openApiDocument.paths["/principals/{principalType}/{principalId}/policy"];
  const getPolicy = policyPath?.get;
  const putPolicy = policyPath?.put;
  if (getPolicy === undefined || putPolicy?.requestBody === undefined) {
    throw new Error("Principal policy OpenAPI operations are missing");
  }

  expect(getPolicy.operationId).toBe("principals.policy.get");
  expect(putPolicy.operationId).toBe("principals.policy.update");
  expect(getPolicy.parameters).toHaveLength(2);
  expect(getPolicy.parameters[0]).toMatchObject({
    in: "path",
    name: "principalType",
    required: true,
    schema: { enum: ["group", "organization"] },
  });
  expect(getPolicy.parameters[1]).toMatchObject({
    in: "path",
    name: "principalId",
    required: true,
  });
  expect(Object.keys(getPolicy.responses)).toEqual([
    "200",
    "400",
    "401",
    "404",
    "500",
  ]);
  expect(Object.keys(putPolicy.responses)).toEqual([
    "200",
    "400",
    "401",
    "403",
    "404",
    "409",
    "500",
    "503",
  ]);
  expect(
    putPolicy.requestBody.content["application/json"].schema.required,
  ).toEqual(["encryptedPayload", "memberEnvelopes", "projection", "state"]);
  expect(getPolicy.security).toEqual([{ bearerAuth: [] }]);
  expect(putPolicy.security).toEqual([{ bearerAuth: [] }]);
});
