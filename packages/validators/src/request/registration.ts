import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  isByteArrayOfLength,
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
} from "../util";
import {
  isOrganizationProvisioningRequest,
  type OrganizationProvisioningRequest,
} from "./organizationProvisioning";

export interface RegistrationRequest extends OrganizationProvisioningRequest {
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
}

export function isRegistrationRequest(
  value: unknown,
): value is RegistrationRequest {
  return (
    isOrganizationProvisioningRequest(value) &&
    isPlainObject(value) &&
    hasArrayProperty(value, "signingPublicKey") &&
    isByteArrayOfLength(value.signingPublicKey, ML_DSA87_PUBLIC_KEY_BYTES) &&
    hasArrayProperty(value, "encapsulationPublicKey") &&
    isByteArrayOfLength(
      value.encapsulationPublicKey,
      ML_KEM1024_PUBLIC_KEY_BYTES,
    )
  );
}
