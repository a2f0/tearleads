import { z } from "zod";
import { loosePlainObject, nonEmptyStringSchema } from "../../schema";

export const VERIFY_ERROR_CODES = {
  /**
   * The signature is valid but a platform operator suspended the account.
   * Terminal: renewing the session cannot succeed until the suspension lifts.
   */
  accountSuspended: "account_suspended",
  /**
   * The signature is valid, the identity has two-factor authentication turned
   * on, and the request carried no code and no device trust token the server
   * still honors. The person must enter a code; a silent renewal cannot.
   */
  twoFactorRequired: "two_factor_required",
  /** The code was wrong, already used, or not a code at all. */
  twoFactorInvalid: "two_factor_invalid",
  /** Too many wrong codes; codes are refused until the lockout ends. */
  twoFactorLocked: "two_factor_locked",
} as const;

export const VerifyErrorCodeSchema = z.literal([
  VERIFY_ERROR_CODES.accountSuspended,
  VERIFY_ERROR_CODES.twoFactorRequired,
  VERIFY_ERROR_CODES.twoFactorInvalid,
  VERIFY_ERROR_CODES.twoFactorLocked,
]);

export type VerifyErrorCode = z.infer<typeof VerifyErrorCodeSchema>;

export const VerifySuccessResponseSchema = loosePlainObject({
  authenticated: z.literal(true),
  code: z.never().optional(),
  error: z.never().optional(),
  /** Platform-operator flag; gates the root console, enforced server-side. */
  isRoot: z.boolean(),
  organizationId: nonEmptyStringSchema,
  rootContainerId: nonEmptyStringSchema.nullable(),
  token: nonEmptyStringSchema,
  /**
   * Issued when a code was verified with `rememberDevice`; sending it with a
   * later sign-in from this device stands in for a code until it expires.
   */
  twoFactorDeviceToken: nonEmptyStringSchema.optional(),
  userId: nonEmptyStringSchema,
  /** Single-use upgrade ticket for this session's first websocket connect. */
  wsTicket: nonEmptyStringSchema,
});

export const VerifyFailureResponseSchema = loosePlainObject({
  authenticated: z.literal(false),
  code: VerifyErrorCodeSchema.optional(),
  error: z.string().optional(),
  isRoot: z.never().optional(),
  organizationId: z.never().optional(),
  rootContainerId: z.never().optional(),
  token: z.never().optional(),
  userId: z.never().optional(),
  wsTicket: z.never().optional(),
});

export type VerifySuccessResponse = z.infer<typeof VerifySuccessResponseSchema>;
export type VerifyFailureResponse = z.infer<typeof VerifyFailureResponseSchema>;
export type VerifyResponse = VerifySuccessResponse | VerifyFailureResponse;

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  return (
    VerifySuccessResponseSchema.safeParse(value).success ||
    VerifyFailureResponseSchema.safeParse(value).success
  );
}
