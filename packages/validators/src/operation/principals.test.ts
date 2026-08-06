import { expect, test } from "bun:test";
import { PutPrincipalPolicyRequestSchema } from "../request";
import {
  ErrorResponseSchema,
  PrincipalPolicyBundleResponseSchema,
  PrincipalPolicyErrorResponseSchema,
} from "../response";
import { operationRequestPath, operationRoutePath } from "./definition";
import {
  getPrincipalPolicyOperation,
  PrincipalPolicyPathParamsSchema,
  putPrincipalPolicyOperation,
} from "./principals";

const principalId = "11111111-1111-4111-8111-111111111111";

test("principal policy operations own their HTTP contracts", () => {
  expect(getPrincipalPolicyOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 404, 500],
    id: "principals.policy.get",
    method: "GET",
    params: PrincipalPolicyPathParamsSchema,
    path: "/principals/{principalType}/{principalId}/policy",
    responses: { 200: PrincipalPolicyBundleResponseSchema },
  });
  expect(getPrincipalPolicyOperation.failureResponses).toEqual({
    400: PrincipalPolicyErrorResponseSchema,
    401: ErrorResponseSchema,
    404: PrincipalPolicyErrorResponseSchema,
    500: ErrorResponseSchema,
  });
  expect(putPrincipalPolicyOperation).toMatchObject({
    auth: "session",
    body: PutPrincipalPolicyRequestSchema,
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    id: "principals.policy.update",
    method: "PUT",
    params: PrincipalPolicyPathParamsSchema,
    path: "/principals/{principalType}/{principalId}/policy",
    responses: { 200: PrincipalPolicyBundleResponseSchema },
  });
  expect(putPrincipalPolicyOperation.failureResponses).toEqual({
    400: PrincipalPolicyErrorResponseSchema,
    401: ErrorResponseSchema,
    403: PrincipalPolicyErrorResponseSchema,
    404: PrincipalPolicyErrorResponseSchema,
    409: PrincipalPolicyErrorResponseSchema,
    500: ErrorResponseSchema,
    503: PrincipalPolicyErrorResponseSchema,
  });
});

test("principal policy paths derive from the shared path schema", () => {
  expect(operationRoutePath(getPrincipalPolicyOperation)).toBe(
    "/principals/:principalType/:principalId/policy",
  );
  expect(
    operationRequestPath(getPrincipalPolicyOperation, {
      principalId,
      principalType: "group",
    }),
  ).toBe(`/principals/group/${principalId}/policy`);
  expect(() =>
    operationRequestPath(getPrincipalPolicyOperation, {
      principalId: "invalid",
      principalType: "group",
    }),
  ).toThrow("Invalid path parameters for principals.policy.get");
  expect(() =>
    operationRequestPath(getPrincipalPolicyOperation, {
      principalId,
      principalType: "team" as never,
    }),
  ).toThrow("Invalid path parameters for principals.policy.get");
});
