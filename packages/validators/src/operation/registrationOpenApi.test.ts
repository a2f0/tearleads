import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { registerOperation } from "./auth";
import { openApiDocument } from "./openApi";

const registerPost = openApiDocument.paths["/auth/register"]?.post;
if (registerPost?.requestBody === undefined) {
  throw new Error("Registration OpenAPI request is missing");
}

const requestSchema =
  registerPost.requestBody.content["application/json"]?.schema;
if (requestSchema === undefined) {
  throw new Error("Registration OpenAPI JSON request is missing");
}
const { encapsulationPublicKey, signingPublicKey } =
  requestSchema.properties ?? {};
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSigningKey = ajv.compile(signingPublicKey ?? false);
const validateEncapsulationKey = ajv.compile(encapsulationPublicKey ?? false);

test("registration OpenAPI documents its nested contract and all errors", () => {
  expect(registerPost.operationId).toBe("auth.register");
  expect(registerPost.parameters).toEqual([]);
  expect(registerPost.security).toEqual([]);
  expect(Object.keys(registerPost.responses)).toEqual([
    "200",
    "400",
    "403",
    "404",
    "409",
    "500",
    "503",
  ]);
  expect(requestSchema.required).toContain("initialRootContainer");
  expect(requestSchema.required).toContain("initialRootMetadataDocument");
  expect(registerPost["x-symcrypt-runtime-refinements"]).toEqual(
    registerOperation.runtimeRefinements,
  );

  expect(validateSigningKey(Array(2592).fill(0))).toBe(true);
  expect(validateSigningKey([0])).toBe(false);
  expect(validateEncapsulationKey(Array(1568).fill(0))).toBe(true);
  expect(validateEncapsulationKey([0])).toBe(false);
});
