import type { z } from "zod";
import { fixedLengthBase64BytesSchema, loosePlainObject } from "../schema";
import {
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
} from "../util";
import { organizationProvisioningRequestShape } from "./organizationProvisioning";

export const RegistrationRequestSchema = loosePlainObject({
  ...organizationProvisioningRequestShape,
  encapsulationPublicKey: fixedLengthBase64BytesSchema(
    ML_KEM1024_PUBLIC_KEY_BYTES,
  ),
  signingPublicKey: fixedLengthBase64BytesSchema(ML_DSA87_PUBLIC_KEY_BYTES),
});

export type RegistrationRequest = z.infer<typeof RegistrationRequestSchema>;

export function isRegistrationRequest(
  value: unknown,
): value is RegistrationRequest {
  return RegistrationRequestSchema.safeParse(value).success;
}
