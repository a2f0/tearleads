import { isNumberArray } from "../isNumberArray";
import { isPlainObject } from "../isPlainObject";
import { hasArrayProperty } from "../util";

export interface PublicKeyRequest {
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
}

export function isPublicKeyRequest(value: unknown): value is PublicKeyRequest {
  return (
    isPlainObject(value) &&
    hasArrayProperty(value, "signingPublicKey") &&
    isNumberArray(value.signingPublicKey) &&
    hasArrayProperty(value, "encapsulationPublicKey") &&
    isNumberArray(value.encapsulationPublicKey)
  );
}
