import { expect, test } from "bun:test";
import {
  ChallengeRequestSchema,
  RegistrationRequestSchema,
  VerifyRequestSchema,
} from "../request";
import {
  ChallengeErrorResponseSchema,
  ChallengeResponseSchema,
  DestroySessionResponseSchema,
  ErrorResponseSchema,
  ListSessionsResponseSchema,
  RegistrationResponseSchema,
  UserIdentityResponseSchema,
  VerifyFailureResponseSchema,
  VerifySuccessResponseSchema,
  WebSocketTicketResponseSchema,
} from "../response";
import {
  challengeOperation,
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  registerOperation,
  userIdentityOperation,
  verifyOperation,
  webSocketTicketOperation,
} from "./auth";
import { operationRequestPath, operationRoutePath } from "./definition";

test("auth operations own their HTTP contract metadata", () => {
  expect(challengeOperation).toMatchObject({
    auth: "none",
    body: ChallengeRequestSchema,
    failureStatuses: [400, 404, 500, 503],
    id: "auth.challenge",
    method: "POST",
    path: "/auth/challenge",
    responses: { 200: ChallengeResponseSchema },
  });
  expect(challengeOperation.failureResponses).toEqual({
    400: ChallengeErrorResponseSchema,
    404: ChallengeErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });

  expect(verifyOperation).toMatchObject({
    auth: "none",
    body: VerifyRequestSchema,
    failureStatuses: [400, 401, 404, 500, 503],
    id: "auth.verify",
    method: "POST",
    path: "/auth/verify",
    responses: { 200: VerifySuccessResponseSchema },
  });
  expect(verifyOperation.failureResponses).toEqual({
    400: ChallengeErrorResponseSchema,
    401: VerifyFailureResponseSchema,
    404: VerifyFailureResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });

  expect(registerOperation).toMatchObject({
    auth: "none",
    body: RegistrationRequestSchema,
    failureStatuses: [400, 403, 404, 409, 500, 503],
    id: "auth.register",
    method: "POST",
    path: "/auth/register",
    responses: { 200: RegistrationResponseSchema },
  });
  expect(registerOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
});

test("session and identity operations own their HTTP contract metadata", () => {
  expect(logoutOperation).toMatchObject({
    auth: "session",
    failureStatuses: [401, 500, 503],
    id: "auth.logout",
    method: "POST",
    path: "/auth/logout",
    responses: { 200: DestroySessionResponseSchema },
  });
  expect(webSocketTicketOperation).toMatchObject({
    auth: "session",
    failureStatuses: [401, 500, 503],
    id: "auth.webSocketTicket",
    method: "POST",
    path: "/auth/ws-ticket",
    responses: { 200: WebSocketTicketResponseSchema },
  });
  expect(listSessionsOperation).toMatchObject({
    auth: "session",
    failureStatuses: [401, 500, 503],
    id: "auth.sessions.list",
    method: "GET",
    path: "/auth/sessions",
    responses: { 200: ListSessionsResponseSchema },
  });
  expect(destroySessionOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 404, 500, 503],
    id: "auth.sessions.destroy",
    method: "DELETE",
    path: "/auth/sessions/{sessionId}",
    responses: { 200: DestroySessionResponseSchema },
  });
  expect(userIdentityOperation).toMatchObject({
    auth: "session",
    failureStatuses: [401, 404, 500, 503],
    id: "auth.userIdentity",
    method: "GET",
    path: "/auth/user-identity/{userId}",
    responses: { 200: UserIdentityResponseSchema },
  });

  for (const operation of [
    logoutOperation,
    webSocketTicketOperation,
    listSessionsOperation,
    destroySessionOperation,
    userIdentityOperation,
  ]) {
    expect("body" in operation ? operation.body : undefined).toBeUndefined();
    expect(Object.values(operation.failureResponses)).toContain(
      ErrorResponseSchema,
    );
  }
});

test("auth operation paths are shared with validated parameters", () => {
  expect(operationRoutePath(challengeOperation)).toBe("/auth/challenge");
  expect(operationRequestPath(challengeOperation, {})).toBe("/auth/challenge");
  expect(operationRoutePath(verifyOperation)).toBe("/auth/verify");
  expect(operationRequestPath(verifyOperation, {})).toBe("/auth/verify");
  expect(operationRequestPath(registerOperation, {})).toBe("/auth/register");
  expect(operationRequestPath(logoutOperation, {})).toBe("/auth/logout");
  expect(operationRequestPath(listSessionsOperation, {})).toBe(
    "/auth/sessions",
  );
  expect(
    operationRequestPath(destroySessionOperation, {
      sessionId: "a".repeat(64),
    }),
  ).toBe(`/auth/sessions/${"a".repeat(64)}`);
  expect(() =>
    operationRequestPath(destroySessionOperation, { sessionId: "invalid" }),
  ).toThrow("Invalid path parameters for auth.sessions.destroy");
  expect(
    operationRequestPath(userIdentityOperation, { userId: "user/id" }),
  ).toBe("/auth/user-identity/user%2Fid");
  expect(operationRequestPath(webSocketTicketOperation, {})).toBe(
    "/auth/ws-ticket",
  );
});
