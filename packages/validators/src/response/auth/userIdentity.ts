import { isPlainObject } from "../../isPlainObject";
import { hasStringProperty, isSha256HexString } from "../../util";

export interface UserIdentityResponse {
  userId: string;
  signingPublicKey: string;
  signingKeyFingerprint: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
}

export function isUserIdentityResponse(
  value: unknown,
): value is UserIdentityResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "signingPublicKey") &&
    hasStringProperty(value, "signingKeyFingerprint") &&
    isSha256HexString(value.signingKeyFingerprint) &&
    hasStringProperty(value, "encapsulationPublicKey") &&
    hasStringProperty(value, "encapsulationKeyFingerprint") &&
    isSha256HexString(value.encapsulationKeyFingerprint)
  );
}
