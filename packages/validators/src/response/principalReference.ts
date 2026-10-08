import { z } from "zod";
import { boundedPositiveIntegerSchema, loosePlainObject } from "../schema";

export const ReferencedPrincipalStateResponseShape = {
  keyEpoch: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  keyFingerprint: z.string(),
  principalId: z.string(),
  principalType: z.literal(["group", "organization"]),
  stateHash: z.string(),
  version: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
};

export const ReferencedPrincipalStateResponseSchema = loosePlainObject(
  ReferencedPrincipalStateResponseShape,
);

export type ReferencedPrincipalStateResponse = z.infer<
  typeof ReferencedPrincipalStateResponseSchema
>;

export function isReferencedPrincipalStateResponse(
  value: unknown,
): value is ReferencedPrincipalStateResponse {
  return ReferencedPrincipalStateResponseSchema.safeParse(value).success;
}
