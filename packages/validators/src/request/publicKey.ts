import { isNumberArray } from "../isNumberArray";
import { isPlainObject } from "../isPlainObject";

export interface PublicKeyRequest {
  publicKey: number[];
}

export function isPublicKeyRequest(value: unknown): value is PublicKeyRequest {
  return isPlainObject(value) && isNumberArray(value["publicKey"]);
}
