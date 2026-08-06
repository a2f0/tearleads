import type { z } from "zod";
import { authChallengeHexStringSchema, loosePlainObject } from "../../schema";
import { ErrorResponseSchema, isErrorResponse } from "../error";

export const ChallengeResponseSchema = loosePlainObject({
  challenge: authChallengeHexStringSchema,
});

export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;

export function isChallengeResponse(
  value: unknown,
): value is ChallengeResponse {
  return ChallengeResponseSchema.safeParse(value).success;
}

export const ChallengeErrorResponseSchema = ErrorResponseSchema;
export type ChallengeErrorResponse = z.infer<
  typeof ChallengeErrorResponseSchema
>;
export const isChallengeErrorResponse = isErrorResponse;
