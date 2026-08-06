import { z } from "zod";
import { authChallengeHexStringSchema, loosePlainObject } from "../../schema";

export const ChallengeResponseSchema = loosePlainObject({
  challenge: authChallengeHexStringSchema,
});

export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;

export function isChallengeResponse(
  value: unknown,
): value is ChallengeResponse {
  return ChallengeResponseSchema.safeParse(value).success;
}

export const ChallengeErrorResponseSchema = loosePlainObject({
  error: z.string(),
});

export type ChallengeErrorResponse = z.infer<
  typeof ChallengeErrorResponseSchema
>;

export function isChallengeErrorResponse(
  value: unknown,
): value is ChallengeErrorResponse {
  return ChallengeErrorResponseSchema.safeParse(value).success;
}
