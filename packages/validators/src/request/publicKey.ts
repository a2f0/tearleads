import { isNumberArray } from "../isNumberArray";
import { isPlainObject } from "../isPlainObject";

export interface PublicKeyRequest {
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
}

export function isPublicKeyRequest(value: unknown): value is PublicKeyRequest {
  return (
    isPlainObject(value) &&
    isNumberArray(value["signingPublicKey"]) &&
    isNumberArray(value["encapsulationPublicKey"])
  );
}
