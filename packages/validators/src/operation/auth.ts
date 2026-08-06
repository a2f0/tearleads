import { z } from "zod";
import {
  ChallengeRequestSchema,
  isChallengeRequest,
  isVerifyRequest,
  VerifyRequestSchema,
} from "../request";
import {
  ChallengeErrorResponseSchema,
  ChallengeResponseSchema,
  isChallengeResponse,
  isVerifyResponse,
  VerifyFailureResponseSchema,
  VerifySuccessResponseSchema,
} from "../response";
import { defineJsonOperation } from "./definition";

const AuthPathParamsSchema = z.strictObject({});

export const challengeOperation = defineJsonOperation({
  auth: "none",
  body: ChallengeRequestSchema,
  failureResponses: {
    400: ChallengeErrorResponseSchema,
    404: ChallengeErrorResponseSchema,
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

export const isChallengeOperationRequest = isChallengeRequest;
export const isChallengeOperationResponse = isChallengeResponse;
export const isVerifyOperationRequest = isVerifyRequest;
export const isVerifyOperationResponse = isVerifyResponse;
