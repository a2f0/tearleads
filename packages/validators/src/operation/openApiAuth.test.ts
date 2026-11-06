import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { openApiDocument } from "./openApi";

const ajv = new Ajv2020({ allErrors: true, strict: true });

const challengePost = openApiDocument.paths["/auth/challenge"]?.post;
const verifyPost = openApiDocument.paths["/auth/verify"]?.post;
if (challengePost === undefined || verifyPost === undefined) {
  throw new Error("Auth OpenAPI operations are missing");
}
if (
  challengePost.requestBody === undefined ||
  verifyPost.requestBody === undefined
) {
  throw new Error("Auth OpenAPI request bodies are missing");
}

const challengeRequestSchema =
  challengePost.requestBody.content["application/json"]?.schema;
const verifyRequestSchema =
  verifyPost.requestBody.content["application/json"]?.schema;
if (challengeRequestSchema === undefined || verifyRequestSchema === undefined) {
  throw new Error("Auth OpenAPI JSON request bodies are missing");
}
const validateChallengeRequest = ajv.compile(challengeRequestSchema);
const validateVerifyRequest = ajv.compile(verifyRequestSchema);

test("auth operations emit their public request and response contracts", () => {
  expect(challengePost.operationId).toBe("auth.challenge");
  expect(challengePost.parameters).toEqual([]);
  expect(challengePost.security).toEqual([]);
  expect(Object.keys(challengePost.responses)).toEqual([
    "200",
    "400",
    "404",
    "500",
    "503",
  ]);
  expect(verifyPost.operationId).toBe("auth.verify");
  expect(verifyPost.parameters).toEqual([]);
  expect(Object.keys(verifyPost.responses)).toEqual([
    "200",
    "400",
    "401",
    "403",
    "404",
    "500",
    "503",
  ]);

  expect(
    validateChallengeRequest({ fingerprint: "a".repeat(64), future: true }),
  ).toBe(true);
  expect(validateChallengeRequest({ fingerprint: "A".repeat(64) })).toBe(false);
  expect(
    validateVerifyRequest({
      fingerprint: "a".repeat(64),
      signature: Buffer.alloc(4627).toString("base64"),
    }),
  ).toBe(true);
  for (const signature of [
    [0],
    Array.from({ length: 4627 }, () => 0),
    Buffer.alloc(4626).toString("base64"),
  ]) {
    expect(
      validateVerifyRequest({ fingerprint: "a".repeat(64), signature }),
    ).toBe(false);
  }
});

test("bodyless auth operations omit request bodies and emit path parameters", () => {
  const listSessionsGet = openApiDocument.paths["/auth/sessions"]?.get;
  const destroySessionDelete =
    openApiDocument.paths["/auth/sessions/{sessionId}"]?.delete;
  const userIdentityGet =
    openApiDocument.paths["/auth/user-identity/{userId}"]?.get;
  const logoutPost = openApiDocument.paths["/auth/logout"]?.post;
  const webSocketTicketPost = openApiDocument.paths["/auth/ws-ticket"]?.post;

  for (const operation of [
    listSessionsGet,
    destroySessionDelete,
    userIdentityGet,
    logoutPost,
    webSocketTicketPost,
  ]) {
    expect(operation).toBeDefined();
    expect(operation?.requestBody).toBeUndefined();
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  }

  expect(destroySessionDelete?.parameters).toEqual([
    {
      explode: false,
      in: "path",
      name: "sessionId",
      required: true,
      schema: {
        maxLength: 64,
        minLength: 64,
        pattern: "^[0-9a-f]+$",
        type: "string",
      },
      style: "simple",
    },
  ]);
  expect(userIdentityGet?.parameters).toEqual([
    {
      explode: false,
      in: "path",
      name: "userId",
      required: true,
      schema: { type: "string" },
      style: "simple",
    },
  ]);
  expect(Object.keys(destroySessionDelete?.responses ?? {})).toEqual([
    "200",
    "400",
    "401",
    "404",
    "500",
    "503",
  ]);
});
