import { expect, test } from "bun:test";
import { ChallengeRequestSchema, VerifyRequestSchema } from "../request";
import {
  ChallengeErrorResponseSchema,
  ChallengeResponseSchema,
  VerifyFailureResponseSchema,
  VerifySuccessResponseSchema,
} from "../response";
import { challengeOperation, verifyOperation } from "./auth";
import { operationRequestPath, operationRoutePath } from "./definition";

test("auth operations own their HTTP contract metadata", () => {
  expect(challengeOperation).toMatchObject({
    auth: "none",
    body: ChallengeRequestSchema,
    failureStatuses: [400, 404, 500],
    id: "auth.challenge",
    method: "POST",
    path: "/auth/challenge",
    responses: { 200: ChallengeResponseSchema },
  });
  expect(challengeOperation.failureResponses).toEqual({
    400: ChallengeErrorResponseSchema,
    404: ChallengeErrorResponseSchema,
  });

  expect(verifyOperation).toMatchObject({
    auth: "none",
    body: VerifyRequestSchema,
    failureStatuses: [400, 401, 404, 500],
    id: "auth.verify",
    method: "POST",
    path: "/auth/verify",
    responses: { 200: VerifySuccessResponseSchema },
  });
  expect(verifyOperation.failureResponses).toEqual({
    400: ChallengeErrorResponseSchema,
    401: VerifyFailureResponseSchema,
    404: VerifyFailureResponseSchema,
  });
});

test("auth operation paths are shared without parameters", () => {
  expect(operationRoutePath(challengeOperation)).toBe("/auth/challenge");
  expect(operationRequestPath(challengeOperation, {})).toBe("/auth/challenge");
  expect(operationRoutePath(verifyOperation)).toBe("/auth/verify");
  expect(operationRequestPath(verifyOperation, {})).toBe("/auth/verify");
});
