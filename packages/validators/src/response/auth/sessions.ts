import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  sha256HexStringSchema,
} from "../../schema";

export const UserSessionResponseSchema = loosePlainObject({
  createdAt: z.string(),
  id: sha256HexStringSchema,
  ipAddresses: arraySchema(nonEmptyStringSchema),
  isCurrent: z.boolean(),
  lastActiveAt: z.string(),
  lastActiveIp: nonEmptyStringSchema.nullable(),
  signingKeyFingerprint: z.string(),
});

export type UserSessionResponse = z.infer<typeof UserSessionResponseSchema>;

export const ListSessionsResponseSchema = loosePlainObject({
  sessions: arraySchema(UserSessionResponseSchema),
});

export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

export const DestroySessionResponseSchema = loosePlainObject({
  message: z.literal("ok"),
});

export type DestroySessionResponse = z.infer<
  typeof DestroySessionResponseSchema
>;

export function isUserSessionResponse(
  value: unknown,
): value is UserSessionResponse {
  return UserSessionResponseSchema.safeParse(value).success;
}

export function isListSessionsResponse(
  value: unknown,
): value is ListSessionsResponse {
  return ListSessionsResponseSchema.safeParse(value).success;
}

export function isDestroySessionResponse(
  value: unknown,
): value is DestroySessionResponse {
  return DestroySessionResponseSchema.safeParse(value).success;
}
