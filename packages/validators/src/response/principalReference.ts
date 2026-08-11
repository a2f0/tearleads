import { z } from "zod";
import { loosePlainObject } from "../schema";

export const ReferencedPrincipalStateResponseSchema = loosePlainObject({
  keyEpoch: z.number(),
  keyFingerprint: z.string(),
  principalId: z.string(),
  principalType: z.literal(["group", "organization"]),
  stateHash: z.string(),
  version: z.number(),
});

export type ReferencedPrincipalStateResponse = z.infer<
  typeof ReferencedPrincipalStateResponseSchema
>;

export function isReferencedPrincipalStateResponse(
  value: unknown,
): value is ReferencedPrincipalStateResponse {
  return ReferencedPrincipalStateResponseSchema.safeParse(value).success;
}
