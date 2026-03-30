import { isNumberArray } from "../../isNumberArray";
import { isPlainObject } from "../../isPlainObject";
import { hasArrayProperty, hasStringProperty } from "../../util";

export interface VerifyRequest {
  fingerprint: string;
  signature: number[];
}

export function isVerifyRequest(value: unknown): value is VerifyRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "fingerprint") &&
    hasArrayProperty(value, "signature") &&
    isNumberArray(value.signature)
  );
}
