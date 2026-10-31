import type { z } from "zod";
import {
  fixedLengthBase64BytesSchema,
  loosePlainObject,
  sha256HexStringSchema,
} from "../../schema";
import { ML_DSA87_SIGNATURE_BYTES } from "../../util";

export const VerifyRequestSchema = loosePlainObject({
  fingerprint: sha256HexStringSchema,
  signature: fixedLengthBase64BytesSchema(ML_DSA87_SIGNATURE_BYTES),
});

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export function isVerifyRequest(value: unknown): value is VerifyRequest {
  return VerifyRequestSchema.safeParse(value).success;
}
