import { isPlainObject } from "../../isPlainObject";
import {
  hasArrayProperty,
  hasStringProperty,
  isByteArrayOfLength,
  isSha256HexString,
  ML_DSA87_SIGNATURE_BYTES,
} from "../../util";

export interface VerifyRequest {
  fingerprint: string;
  signature: number[];
}

export function isVerifyRequest(value: unknown): value is VerifyRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "fingerprint") &&
    isSha256HexString(value.fingerprint) &&
    hasArrayProperty(value, "signature") &&
    isByteArrayOfLength(value.signature, ML_DSA87_SIGNATURE_BYTES)
  );
}
