import { isPlainObject } from "../../isPlainObject";
import { hasStringProperty, isSha256HexString } from "../../util";

export interface EncapsulationKeyResponse {
  userId: string;
  signingPublicKey: string;
  signingKeyFingerprint: string;
  encapsulationPublicKey: string;
}

export function isEncapsulationKeyResponse(
  value: unknown,
): value is EncapsulationKeyResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "signingPublicKey") &&
    hasStringProperty(value, "signingKeyFingerprint") &&
    isSha256HexString(value.signingKeyFingerprint) &&
    hasStringProperty(value, "encapsulationPublicKey")
  );
}
