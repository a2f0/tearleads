import { isNumberArray } from "../../isNumberArray";
import { isRecord } from "../../isRecord";

export interface VerifyRequest {
  fingerprint: string;
  signature: number[];
}

export function isVerifyRequest(value: unknown): value is VerifyRequest {
  return (
    isRecord(value) &&
    typeof value["fingerprint"] === "string" &&
    isNumberArray(value["signature"])
  );
}
