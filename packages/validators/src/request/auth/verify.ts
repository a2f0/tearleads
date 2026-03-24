import { isNumberArray } from "../../isNumberArray";
import { isPlainObject } from "../../isPlainObject";

export interface VerifyRequest {
  fingerprint: string;
  signature: number[];
}

export function isVerifyRequest(value: unknown): value is VerifyRequest {
  return (
    isPlainObject(value) &&
    typeof value["fingerprint"] === "string" &&
    isNumberArray(value["signature"])
  );
}
