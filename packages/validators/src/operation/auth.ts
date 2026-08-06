import { z } from "zod";
import { documentSyncRequestRuntimeRefinements } from "../documentSyncRefinements";
import {
  organizationProvisioningRequestRuntimeRefinements,
  organizationProvisioningResponseRuntimeRefinements,
} from "../organizationProvisioningRefinements";
import {
  ChallengeRequestSchema,
  isChallengeRequest,
  isRegistrationRequest,
  isVerifyRequest,
  RegistrationRequestSchema,
  VerifyRequestSchema,
} from "../request";
import {
  ChallengeErrorResponseSchema,
  ChallengeResponseSchema,
  DestroySessionResponseSchema,
  ErrorResponseSchema,
  isChallengeResponse,
  isDestroySessionResponse,
  isListSessionsResponse,
  isRegistrationResponse,
  isUserIdentityResponse,
  isVerifyResponse,
  isWebSocketTicketResponse,
  ListSessionsResponseSchema,
  RegistrationResponseSchema,
  UserIdentityResponseSchema,
  VerifyFailureResponseSchema,
  VerifySuccessResponseSchema,
  WebSocketTicketResponseSchema,
} from "../response";
import { sha256HexStringSchema } from "../schema";
import { defineJsonOperation } from "./definition";

const AuthPathParamsSchema = z.strictObject({});
const SessionPathParamsSchema = z.strictObject({
  sessionId: sha256HexStringSchema,
});
const UserIdentityPathParamsSchema = z.strictObject({
  userId: z.string(),
});

export const challengeOperation = defineJsonOperation({
  auth: "none",
  body: ChallengeRequestSchema,
  failureResponses: {
    400: ChallengeErrorResponseSchema,
    404: ChallengeErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 404, 500],
  id: "auth.challenge",
  method: "POST",
  params: AuthPathParamsSchema,
  path: "/auth/challenge",
  responses: {
    200: ChallengeResponseSchema,
  },
});

export const verifyOperation = defineJsonOperation({
  auth: "none",
  body: VerifyRequestSchema,
  failureResponses: {
    400: ChallengeErrorResponseSchema,
    401: VerifyFailureResponseSchema,
    404: VerifyFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 404, 500],
  id: "auth.verify",
  method: "POST",
  params: AuthPathParamsSchema,
  path: "/auth/verify",
  responses: {
    200: VerifySuccessResponseSchema,
  },
});

export const registerOperation = defineJsonOperation({
  auth: "none",
  body: RegistrationRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 403, 404, 409, 500, 503],
  id: "auth.register",
  method: "POST",
  params: AuthPathParamsSchema,
  path: "/auth/register",
  responses: {
    200: RegistrationResponseSchema,
  },
  runtimeRefinements: [
    ...documentSyncRequestRuntimeRefinements,
    ...organizationProvisioningRequestRuntimeRefinements,
    ...organizationProvisioningResponseRuntimeRefinements,
  ],
});

export const logoutOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "auth.logout",
  method: "POST",
  params: AuthPathParamsSchema,
  path: "/auth/logout",
  responses: {
    200: DestroySessionResponseSchema,
  },
});

export const webSocketTicketOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "auth.webSocketTicket",
  method: "POST",
  params: AuthPathParamsSchema,
  path: "/auth/ws-ticket",
  responses: {
    200: WebSocketTicketResponseSchema,
  },
});

export const listSessionsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "auth.sessions.list",
  method: "GET",
  params: AuthPathParamsSchema,
  path: "/auth/sessions",
  responses: {
    200: ListSessionsResponseSchema,
  },
});

export const destroySessionOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 404, 500],
  id: "auth.sessions.destroy",
  method: "DELETE",
  params: SessionPathParamsSchema,
  path: "/auth/sessions/{sessionId}",
  responses: {
    200: DestroySessionResponseSchema,
  },
});

export const userIdentityOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 404, 500],
  id: "auth.userIdentity",
  method: "GET",
  params: UserIdentityPathParamsSchema,
  path: "/auth/user-identity/{userId}",
  responses: {
    200: UserIdentityResponseSchema,
  },
});

export const isChallengeOperationRequest = isChallengeRequest;
export const isChallengeOperationResponse = isChallengeResponse;
export const isRegistrationOperationRequest = isRegistrationRequest;
export const isRegistrationOperationResponse = isRegistrationResponse;
export const isVerifyOperationRequest = isVerifyRequest;
export const isVerifyOperationResponse = isVerifyResponse;
export const isLogoutOperationResponse = isDestroySessionResponse;
export const isWebSocketTicketOperationResponse = isWebSocketTicketResponse;
export const isListSessionsOperationResponse = isListSessionsResponse;
export const isDestroySessionOperationResponse = isDestroySessionResponse;
export const isUserIdentityOperationResponse = isUserIdentityResponse;
