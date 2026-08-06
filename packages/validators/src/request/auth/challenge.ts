import type { z } from "zod";
import { loosePlainObject, sha256HexStringSchema } from "../../schema";

export const ChallengeRequestSchema = loosePlainObject({
  fingerprint: sha256HexStringSchema,
});

export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;

export function isChallengeRequest(value: unknown): value is ChallengeRequest {
  return ChallengeRequestSchema.safeParse(value).success;
}
