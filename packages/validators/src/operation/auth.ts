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
  SessionFailureResponseSchema,
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
  summary: "Request an auth challenge",
  description:
    "Starts sign-in for a registered identity: the server stores a short-lived random challenge for the signing key fingerprint, and the client signs it and sends the signature to `POST /auth/verify`. No session is needed; an unknown fingerprint returns 404.",
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
    403: VerifyFailureResponseSchema,
    404: VerifyFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 500],
  id: "auth.verify",
  summary: "Verify an auth challenge",
  description:
    "Completes sign-in by checking the challenge signature, bound to the API origin, against the identity's registered signing key, then opens a session and returns its bearer token plus the first WebSocket ticket. Each challenge can be used once. A suspended identity's valid signature is refused with 403 and code `account_suspended`, which clients treat as terminal.",
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
  summary: "Register an identity and bootstrap its root state",
  description:
    "Creates a new identity from its signing and encapsulation public keys and, in one transaction, provisions its personal organization: the reserved `Admins` and `Members` groups, the root container, and their signed policies and metadata documents. The response carries a fresh login challenge, so the client signs in next with `POST /auth/verify`. A signing key that is already registered returns 409.",
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
    401: SessionFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "auth.logout",
  summary: "Destroy the current session",
  description:
    "Ends the session that made the request, so its bearer token stops working. Any signed-in user may call it.",
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
    401: SessionFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "auth.webSocketTicket",
  summary: "Mint a one-time WebSocket ticket",
  description:
    "Issues a single-use, short-lived ticket that authenticates one WebSocket upgrade to the realtime hint gateway, because browsers cannot attach an `Authorization` header to a WebSocket handshake. Clients call it before each reconnect; sign-in already returns the first ticket.",
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
    401: SessionFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "auth.sessions.list",
  summary: "List auth sessions",
  description:
    "Lists the signed-in user's live sessions with their creation time, last activity, IP addresses, and signing key fingerprint, flagging the one that made the request. It only ever returns the caller's own sessions.",
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
    401: SessionFailureResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 404, 500],
  id: "auth.sessions.destroy",
  summary: "Destroy a user session",
  description:
    "Signs out one of the caller's own sessions, for example a lost device. A session id that is unknown or belongs to another user returns 404.",
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
    401: SessionFailureResponseSchema,
    404: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 404, 500],
  id: "auth.userIdentity",
  summary: "Get a complete user identity",
  description:
    "Returns a user's registered signing and encapsulation public keys and fingerprints. Clients never trust the answer alone: they compare it with an identity link or an existing identity pin before using the keys. Any signed-in user may call it; an unknown user returns 404.",
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
