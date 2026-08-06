import type { z } from "zod";
import {
  fixedLengthByteArraySchema,
  loosePlainObject,
  sha256HexStringSchema,
} from "../../schema";
import { ML_DSA87_SIGNATURE_BYTES } from "../../util";

export const VerifyRequestSchema = loosePlainObject({
  fingerprint: sha256HexStringSchema,
  signature: fixedLengthByteArraySchema(ML_DSA87_SIGNATURE_BYTES),
});

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export function isVerifyRequest(value: unknown): value is VerifyRequest {
  return VerifyRequestSchema.safeParse(value).success;
}
