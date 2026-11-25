import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
} from "../../schema";

/** Codes on refused two-factor management requests. */
export const TWO_FACTOR_ERROR_CODES = {
  /** Setup was requested while an authenticator is already turned on. */
  alreadyEnabled: "two_factor_already_enabled",
  /** The code was wrong, already used, or not a code at all. */
  invalidCode: "two_factor_invalid",
  /** Too many wrong codes; codes are refused until the lockout ends. */
  locked: "two_factor_locked",
  /** The request needs an authenticator that is turned on, and none is. */
  notEnabled: "two_factor_not_enabled",
  /** Enabling needs a pending setup from `POST /auth/two-factor/setup`. */
  setupMissing: "two_factor_setup_missing",
} as const;

export const TwoFactorErrorCodeSchema = z.literal([
  TWO_FACTOR_ERROR_CODES.alreadyEnabled,
  TWO_FACTOR_ERROR_CODES.invalidCode,
  TWO_FACTOR_ERROR_CODES.locked,
  TWO_FACTOR_ERROR_CODES.notEnabled,
  TWO_FACTOR_ERROR_CODES.setupMissing,
]);

export type TwoFactorErrorCode = z.infer<typeof TwoFactorErrorCodeSchema>;

export const TwoFactorErrorResponseSchema = loosePlainObject({
  code: TwoFactorErrorCodeSchema.optional(),
  error: z.string(),
});

export type TwoFactorErrorResponse = z.infer<
  typeof TwoFactorErrorResponseSchema
>;

export const TwoFactorStatusResponseSchema = loosePlainObject({
  /** Whether sign-in asks this identity for a second factor. */
  enabled: z.boolean(),
  /** Unused recovery codes; zero while two-factor is off. */
  recoveryCodesRemaining: nonNegativeIntegerSchema,
  /**
   * Organizations that refuse the calling session until it passes a second
   * factor: each requires one of this member, and this session has none.
   */
  requiredByOrganizationIds: arraySchema(nonEmptyStringSchema),
  /** Whether the calling session passed a second factor. */
  sessionVerified: z.boolean(),
});

export type TwoFactorStatusResponse = z.infer<
  typeof TwoFactorStatusResponseSchema
>;

export const TwoFactorSetupResponseSchema = loosePlainObject({
  /** `otpauth://totp/...` URI an authenticator app scans as a QR code. */
  otpauthUri: nonEmptyStringSchema,
  /** The same secret in base32, for typing into an authenticator by hand. */
  secret: nonEmptyStringSchema,
});

export type TwoFactorSetupResponse = z.infer<
  typeof TwoFactorSetupResponseSchema
>;

export const TwoFactorRecoveryCodesResponseSchema = loosePlainObject({
  /** Shown once; the server keeps only their hashes. */
  recoveryCodes: arraySchema(nonEmptyStringSchema),
});

export type TwoFactorRecoveryCodesResponse = z.infer<
  typeof TwoFactorRecoveryCodesResponseSchema
>;

export const TwoFactorEnableResponseSchema = loosePlainObject({
  /** Present when the request asked to remember this device. */
  deviceToken: nonEmptyStringSchema.optional(),
  enabled: z.literal(true),
  recoveryCodes: arraySchema(nonEmptyStringSchema),
});

export type TwoFactorEnableResponse = z.infer<
  typeof TwoFactorEnableResponseSchema
>;

export function isTwoFactorStatusResponse(
  value: unknown,
): value is TwoFactorStatusResponse {
  return TwoFactorStatusResponseSchema.safeParse(value).success;
}

export function isTwoFactorSetupResponse(
  value: unknown,
): value is TwoFactorSetupResponse {
  return TwoFactorSetupResponseSchema.safeParse(value).success;
}

export function isTwoFactorEnableResponse(
  value: unknown,
): value is TwoFactorEnableResponse {
  return TwoFactorEnableResponseSchema.safeParse(value).success;
}

export function isTwoFactorRecoveryCodesResponse(
  value: unknown,
): value is TwoFactorRecoveryCodesResponse {
  return TwoFactorRecoveryCodesResponseSchema.safeParse(value).success;
}
