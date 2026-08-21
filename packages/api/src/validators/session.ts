import { isPlainObject } from "@symcrypt/validators/isPlainObject";
import { isSha256HexString, isUuidV4String } from "@symcrypt/validators/util";
import { z } from "zod";

const sessionIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

const ipAddressesSchema = z.custom<string[]>(
  (value) =>
    Array.isArray(value) &&
    value.every(
      (ipAddress) => typeof ipAddress === "string" && ipAddress.length > 0,
    ),
);

const sessionDataSchema = z.custom<Record<string, unknown>>(isPlainObject).pipe(
  z.object({
    createdAt: z.number().refine(isNonNegativeSafeInteger),
    fingerprint: z.string().refine(isSha256HexString),
    id: sessionIdSchema,
    ipAddresses: ipAddressesSchema,
    lastActiveAt: z.number().refine(isNonNegativeSafeInteger),
    lastActiveIp: z.string().min(1).nullable(),
    userId: z.string().refine(isUuidV4String),
  }),
);

export type SessionData = z.infer<typeof sessionDataSchema>;

export interface SessionCreateInput {
  userId: string;
  fingerprint: string;
  createdAt: number;
  ipAddress?: string | null | undefined;
}

export function isSessionId(value: unknown): value is string {
  return sessionIdSchema.safeParse(value).success;
}

export function isSessionData(value: unknown): value is SessionData {
  return sessionDataSchema.safeParse(value).success;
}
