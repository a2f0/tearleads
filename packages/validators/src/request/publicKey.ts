import { isNumberArray } from "../isNumberArray";
import { isRecord } from "../isRecord";

export interface PublicKeyRequest {
  publicKey: number[];
}

export function isPublicKeyRequest(value: unknown): value is PublicKeyRequest {
  return isRecord(value) && isNumberArray(value["publicKey"]);
}
