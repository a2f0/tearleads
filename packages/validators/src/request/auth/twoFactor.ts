import { z } from "zod";
import {
  boundedNonEmptyStringSchema,
  loosePlainObject,
  sha256HexStringSchema,
} from "../../schema";

/**
 * How a second factor is answered: the current code from an authenticator
 * app, or one of the single-use recovery codes issued when it was turned on.
 */
export const TwoFactorMethodSchema = z.literal(["totp", "recovery_code"]);

export type TwoFactorMethod = z.infer<typeof TwoFactorMethodSchema>;

/** A typed code; the server trims, removes separators, and checks the shape. */
const TwoFactorCodeSchema = boundedNonEmptyStringSchema(32);

/** A device trust token: 32 random bytes as lowercase hex. */
export const TwoFactorDeviceTokenSchema = sha256HexStringSchema;

/**
 * A second factor sent with `POST /auth/verify`. `rememberDevice` asks for a
 * device trust token so this device's later sign-ins, including silent
 * session renewals, need no code for thirty days.
 */
export const TwoFactorLoginCodeSchema = loosePlainObject({
  code: TwoFactorCodeSchema,
  method: TwoFactorMethodSchema,
  rememberDevice: z.boolean(),
});

export type TwoFactorLoginCode = z.infer<typeof TwoFactorLoginCodeSchema>;

/** Confirms a pending authenticator with its current code. */
export const TwoFactorEnableRequestSchema = loosePlainObject({
  code: TwoFactorCodeSchema,
  rememberDevice: z.boolean(),
});

export type TwoFactorEnableRequest = z.infer<
  typeof TwoFactorEnableRequestSchema
>;

/** Proves the second factor again before turning it off or replacing codes. */
export const TwoFactorConfirmationRequestSchema = loosePlainObject({
  code: TwoFactorCodeSchema,
  method: TwoFactorMethodSchema,
});

export type TwoFactorConfirmationRequest = z.infer<
  typeof TwoFactorConfirmationRequestSchema
>;

export function isTwoFactorEnableRequest(
  value: unknown,
): value is TwoFactorEnableRequest {
  return TwoFactorEnableRequestSchema.safeParse(value).success;
}

export function isTwoFactorConfirmationRequest(
  value: unknown,
): value is TwoFactorConfirmationRequest {
  return TwoFactorConfirmationRequestSchema.safeParse(value).success;
}
