import { z } from "zod";
import {
  isTwoFactorConfirmationRequest,
  isTwoFactorEnableRequest,
  TwoFactorConfirmationRequestSchema,
  TwoFactorEnableRequestSchema,
} from "../request";
import {
  ErrorResponseSchema,
  isTwoFactorEnableResponse,
  isTwoFactorRecoveryCodesResponse,
  isTwoFactorSetupResponse,
  isTwoFactorStatusResponse,
  SessionFailureResponseSchema,
  TwoFactorEnableResponseSchema,
  TwoFactorErrorResponseSchema,
  TwoFactorRecoveryCodesResponseSchema,
  TwoFactorSetupResponseSchema,
  TwoFactorStatusResponseSchema,
} from "../response";
import { defineJsonOperation } from "./definition";

const TwoFactorPathParamsSchema = z.strictObject({});

/** Failures of the requests that check a code. */
const codeCheckedFailureResponses = {
  400: TwoFactorErrorResponseSchema,
  401: SessionFailureResponseSchema,
  409: TwoFactorErrorResponseSchema,
  429: TwoFactorErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

const codeCheckedFailureStatuses = [400, 401, 409, 429, 500] as const;

export const getTwoFactorStatusOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: SessionFailureResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 500],
  id: "auth.twoFactor.status",
  summary: "Get two-factor authentication status",
  description:
    "Reports whether the signed-in identity has two-factor authentication turned on, how many unused recovery codes it has, and whether the calling session passed a second factor.",
  method: "GET",
  params: TwoFactorPathParamsSchema,
  path: "/auth/two-factor",
  responses: {
    200: TwoFactorStatusResponseSchema,
  },
});

export const beginTwoFactorSetupOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    401: SessionFailureResponseSchema,
    409: TwoFactorErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [401, 409, 500],
  id: "auth.twoFactor.setup",
  summary: "Start authenticator setup",
  description:
    "Creates a new authenticator secret for the signed-in identity and returns it as an `otpauth://` URI and in base32. Nothing changes at sign-in until `POST /auth/two-factor/enable` confirms a code from it; starting again replaces an unconfirmed secret. An identity that already has two-factor authentication turned on gets 409.",
  method: "POST",
  params: TwoFactorPathParamsSchema,
  path: "/auth/two-factor/setup",
  responses: {
    200: TwoFactorSetupResponseSchema,
  },
});

export const enableTwoFactorOperation = defineJsonOperation({
  auth: "session",
  body: TwoFactorEnableRequestSchema,
  failureResponses: codeCheckedFailureResponses,
  failureStatuses: codeCheckedFailureStatuses,
  id: "auth.twoFactor.enable",
  summary: "Turn on two-factor authentication",
  description:
    "Confirms the pending authenticator with its current code and turns on two-factor authentication. The response carries ten single-use recovery codes, shown only once. The calling session counts as having passed a second factor; the identity's other sessions are revoked, so each device signs in again with a code. A wrong code returns 400 and repeated wrong codes lock code entry for a while with 429.",
  method: "POST",
  params: TwoFactorPathParamsSchema,
  path: "/auth/two-factor/enable",
  responses: {
    200: TwoFactorEnableResponseSchema,
  },
});

export const disableTwoFactorOperation = defineJsonOperation({
  auth: "session",
  body: TwoFactorConfirmationRequestSchema,
  failureResponses: codeCheckedFailureResponses,
  failureStatuses: codeCheckedFailureStatuses,
  id: "auth.twoFactor.disable",
  summary: "Turn off two-factor authentication",
  description:
    "Turns off two-factor authentication after checking an authenticator or recovery code. It deletes the secret, the recovery codes, and every remembered device, and revokes the identity's other sessions. Organizations that require two-factor authentication of this member refuse the calling session afterwards.",
  method: "POST",
  params: TwoFactorPathParamsSchema,
  path: "/auth/two-factor/disable",
  responses: {
    200: TwoFactorStatusResponseSchema,
  },
});

export const regenerateTwoFactorRecoveryCodesOperation = defineJsonOperation({
  auth: "session",
  body: TwoFactorConfirmationRequestSchema,
  failureResponses: codeCheckedFailureResponses,
  failureStatuses: codeCheckedFailureStatuses,
  id: "auth.twoFactor.recoveryCodes",
  summary: "Replace two-factor recovery codes",
  description:
    "Replaces every recovery code with ten new ones after checking an authenticator or recovery code. The old codes stop working at once; the new ones are shown only in this response.",
  method: "POST",
  params: TwoFactorPathParamsSchema,
  path: "/auth/two-factor/recovery-codes",
  responses: {
    200: TwoFactorRecoveryCodesResponseSchema,
  },
});

export const isEnableTwoFactorOperationRequest = isTwoFactorEnableRequest;
export const isTwoFactorConfirmationOperationRequest =
  isTwoFactorConfirmationRequest;
export const isGetTwoFactorStatusOperationResponse = isTwoFactorStatusResponse;
export const isBeginTwoFactorSetupOperationResponse = isTwoFactorSetupResponse;
export const isEnableTwoFactorOperationResponse = isTwoFactorEnableResponse;
export const isTwoFactorRecoveryCodesOperationResponse =
  isTwoFactorRecoveryCodesResponse;
