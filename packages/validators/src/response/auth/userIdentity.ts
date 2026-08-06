import { z } from "zod";
import { loosePlainObject, sha256HexStringSchema } from "../../schema";

export const UserIdentityResponseSchema = loosePlainObject({
  encapsulationKeyFingerprint: sha256HexStringSchema,
  encapsulationPublicKey: z.string(),
  signingKeyFingerprint: sha256HexStringSchema,
  signingPublicKey: z.string(),
  userId: z.string(),
});

export type UserIdentityResponse = z.infer<typeof UserIdentityResponseSchema>;

export function isUserIdentityResponse(
  value: unknown,
): value is UserIdentityResponse {
  return UserIdentityResponseSchema.safeParse(value).success;
}
