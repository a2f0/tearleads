import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { isSha256HexString, isUuidV4String } from "@tearleads/validators/util";
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
    /**
     * Organizations that required two-factor sign-in of this user when the
     * session opened. Empty for a session that passed a second factor.
     */
    twoFactorRequiredOrganizationIds: z.array(
      z.string().refine(isUuidV4String),
    ),
    /** Whether sign-in passed a second factor (code or remembered device). */
    twoFactorVerified: z.boolean(),
    userId: z.string().refine(isUuidV4String),
  }),
);

export type SessionData = z.infer<typeof sessionDataSchema>;

/** A session's two-factor standing, fixed when it opens. */
export interface SessionTwoFactorStanding {
  readonly twoFactorRequiredOrganizationIds: readonly string[];
  readonly twoFactorVerified: boolean;
}

/** A stored copy of the standing, detached from the caller's array. */
export function sessionTwoFactorStanding(
  input: SessionTwoFactorStanding,
): Pick<SessionData, "twoFactorRequiredOrganizationIds" | "twoFactorVerified"> {
  return {
    twoFactorRequiredOrganizationIds: [
      ...input.twoFactorRequiredOrganizationIds,
    ],
    twoFactorVerified: input.twoFactorVerified,
  };
}

export interface SessionCreateInput extends SessionTwoFactorStanding {
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
