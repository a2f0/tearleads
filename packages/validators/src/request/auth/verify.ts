import type { z } from "zod";
import {
  fixedLengthBase64BytesSchema,
  loosePlainObject,
  sha256HexStringSchema,
} from "../../schema";
import { ML_DSA87_SIGNATURE_BYTES } from "../../util";
import {
  TwoFactorDeviceTokenSchema,
  TwoFactorLoginCodeSchema,
} from "./twoFactor";

/**
 * `twoFactor` and `twoFactorDeviceToken` matter only for an identity with
 * two-factor authentication turned on; the server ignores them otherwise.
 */
export const VerifyRequestSchema = loosePlainObject({
  fingerprint: sha256HexStringSchema,
  signature: fixedLengthBase64BytesSchema(ML_DSA87_SIGNATURE_BYTES),
  twoFactor: TwoFactorLoginCodeSchema.optional(),
  twoFactorDeviceToken: TwoFactorDeviceTokenSchema.optional(),
});

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export function isVerifyRequest(value: unknown): value is VerifyRequest {
  return VerifyRequestSchema.safeParse(value).success;
}
